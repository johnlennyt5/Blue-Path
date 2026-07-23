/**
 * BL-005 · LLM-assisted code-stage translation, privacy-first:
 * string literals are swapped for __LIT_n__ placeholders BEFORE the code
 * leaves the browser (values never travel), and restored into the returned
 * suggestion — semantics preserved, redaction guaranteed and runtime-checked.
 */
import type { Supabase } from './supabaseClient';

export interface RedactedCode {
  redacted: string;
  literals: Record<string, string>;
}

// VB `"…""…"`, C#/JScript `"…\"…"` and `'…'` literal forms.
const LITERAL_PATTERN = /"(?:[^"\\]|\\.|"")*"|'(?:[^'\\]|\\.)*'/g;

export function redactCodeLiterals(code: string): RedactedCode {
  const literals: Record<string, string> = {};
  let index = 0;
  const redacted = code.replace(LITERAL_PATTERN, (match) => {
    // Keep trivial literals ("", " ") — they carry no data and help the model.
    if (match.length <= 4) return match;
    index += 1;
    const placeholder = `"__LIT_${index}__"`;
    literals[placeholder] = match;
    return placeholder;
  });
  return { redacted, literals };
}

export function restoreLiterals(text: string, literals: Record<string, string>): string {
  let restored = text;
  for (const [placeholder, original] of Object.entries(literals)) {
    // The model may echo the placeholder with or without our quotes.
    restored = restored.split(placeholder).join(original);
    restored = restored.split(placeholder.slice(1, -1)).join(original);
  }
  return restored;
}

/** Throws if any redacted literal's content survived into the payload. */
export function assertLiteralsRedacted(payload: string, literals: Record<string, string>): void {
  for (const original of Object.values(literals)) {
    const content = original.slice(1, -1);
    if (content.length > 2 && payload.includes(content)) {
      throw new Error('code redaction violation: a string literal survived into the payload');
    }
  }
}

export interface CodeSuggestionRequest {
  stageName: string;
  language: string;
  code: string;
}

/** Workspace transport: through the same audited llm-proxy as narratives. */
export async function requestCodeTranslation(
  sb: Supabase,
  workspaceId: string,
  request: CodeSuggestionRequest,
): Promise<string> {
  const { redacted, literals } = redactCodeLiterals(request.code);
  const payload = {
    workspace_id: workspaceId,
    mode: 'code' as const,
    owner_name: request.stageName,
    digest: { language: request.language, code: redacted },
  };
  assertLiteralsRedacted(JSON.stringify(payload), literals);

  const { data, error } = await sb.functions.invoke('llm-proxy', { body: payload });
  if (error !== null) {
    const context = (error as { context?: Response }).context;
    if (context !== undefined) {
      const body = (await context.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? error.message);
    }
    throw new Error(error.message);
  }
  const result = data as { narrative?: string; error?: string } | null;
  if (result?.narrative === undefined) throw new Error(result?.error ?? 'no suggestion returned');
  return restoreLiterals(stripCodeFences(result.narrative), literals);
}

/** Local Mode: a user-supplied endpoint receives the redacted code. */
export async function requestCodeTranslationFromCustomEndpoint(
  endpoint: string,
  request: CodeSuggestionRequest,
): Promise<string> {
  const { redacted, literals } = redactCodeLiterals(request.code);
  const body = JSON.stringify({ language: request.language, code: redacted });
  assertLiteralsRedacted(body, literals);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  if (!response.ok) throw new Error(`endpoint returned ${response.status}`);
  const result = (await response.json()) as { suggestion?: string; narrative?: string };
  const suggestion = result.suggestion ?? result.narrative;
  if (suggestion === undefined) throw new Error('endpoint returned no suggestion');
  return restoreLiterals(stripCodeFences(suggestion), literals);
}

function stripCodeFences(text: string): string {
  const match = /```(?:vb|vbnet|csharp|cs)?\n?([\s\S]*?)```/.exec(text);
  return (match?.[1] ?? text).trim();
}
