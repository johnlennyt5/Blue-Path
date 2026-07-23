/**
 * Blue Prism expression → VB.NET translator (S5-1, ARCHITECTURE §7.1).
 *
 * Pipeline: tokenize → parse (recursive descent, BP precedence) → emit VB
 * with a function map (Len→.Length, Upper→.ToUpper, Math.*, date functions…).
 *
 * Contract: NEVER silently wrong. Anything the translator cannot prove
 * (unknown function, unknown reference, unparseable input, ambiguous
 * collection-field access) is reported in `issues` while still emitting a
 * visible best-effort — callers punch-list every issue.
 */
import type { ExpressionNode } from '@prismshift/ir';
import { sanitizeIdentifier } from './naming';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface TranslateOptions {
  /** Resolve a plain `[Name]` reference to its VB identifier. */
  resolveRef?: (name: string) => string | undefined;
  /** Active collection loop, for `[Collection.Field]` row access. */
  loop?: { collectionName: string; rowVar: string };
}

export interface TranslationResult {
  vb: string;
  issues: string[];
  /** Convenience: issues.length === 0. */
  ok: boolean;
}

export function translateBpExpression(
  raw: string,
  options: TranslateOptions = {},
): TranslationResult {
  const issues: string[] = [];
  const trimmed = raw.trim();
  if (trimmed === '') return { vb: '""', issues: ['Empty expression'], ok: false };

  let ast: ExpressionNode;
  try {
    ast = parse(trimmed);
  } catch (cause) {
    issues.push(`Unable to parse expression: ${cause instanceof Error ? cause.message : String(cause)}`);
    return { vb: trimmed, issues, ok: false };
  }

  const vb = emit(ast, 0, options, issues);
  return { vb, issues, ok: issues.length === 0 };
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type Token =
  | { type: 'number'; value: string }
  | { type: 'string'; value: string } // value includes quotes, "" kept doubled
  | { type: 'ref'; value: string }
  | { type: 'ident'; value: string }
  | { type: 'op'; value: string }
  | { type: 'lparen' }
  | { type: 'rparen' }
  | { type: 'comma' };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i]!;

    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }

    if (ch === '"') {
      let j = i + 1;
      let text = '"';
      while (j < input.length) {
        if (input[j] === '"') {
          if (input[j + 1] === '"') {
            text += '""';
            j += 2;
            continue;
          }
          text += '"';
          j += 1;
          break;
        }
        text += input[j];
        j += 1;
      }
      if (!text.endsWith('"') || text.length < 2) throw new Error('Unterminated string literal');
      tokens.push({ type: 'string', value: text });
      i = j;
      continue;
    }

    if (ch === '[') {
      const close = input.indexOf(']', i);
      if (close === -1) throw new Error('Unterminated data item reference');
      tokens.push({ type: 'ref', value: input.slice(i + 1, close).trim() });
      i = close + 1;
      continue;
    }

    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(input[i + 1] ?? ''))) {
      const match = /^[0-9]*\.?[0-9]+/.exec(input.slice(i))!;
      tokens.push({ type: 'number', value: match[0] });
      i += match[0].length;
      continue;
    }

    if (/[A-Za-z_]/.test(ch)) {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(input.slice(i))!;
      tokens.push({ type: 'ident', value: match[0] });
      i += match[0].length;
      continue;
    }

    if (ch === '(') {
      tokens.push({ type: 'lparen' });
      i += 1;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'rparen' });
      i += 1;
      continue;
    }
    if (ch === ',') {
      tokens.push({ type: 'comma' });
      i += 1;
      continue;
    }

    const two = input.slice(i, i + 2);
    if (two === '<>' || two === '<=' || two === '>=') {
      tokens.push({ type: 'op', value: two });
      i += 2;
      continue;
    }
    if ('&+-*/^=<>'.includes(ch)) {
      tokens.push({ type: 'op', value: ch });
      i += 1;
      continue;
    }

    throw new Error(`Unexpected character "${ch}"`);
  }

  return tokens;
}

// ---------------------------------------------------------------------------
// Parser (precedence: OR < AND < NOT < comparison < & < +- < */ < ^ < unary-)
// ---------------------------------------------------------------------------

function parse(input: string): ExpressionNode {
  const tokens = tokenize(input);
  let position = 0;

  const peek = (): Token | undefined => tokens[position];
  const next = (): Token => {
    const token = tokens[position];
    if (!token) throw new Error('Unexpected end of expression');
    position += 1;
    return token;
  };
  const isKeyword = (token: Token | undefined, word: string): boolean =>
    token?.type === 'ident' && token.value.toUpperCase() === word;

  function parseOr(): ExpressionNode {
    let left = parseAnd();
    while (isKeyword(peek(), 'OR')) {
      next();
      left = { type: 'binary', op: 'Or', left, right: parseAnd() };
    }
    return left;
  }

  function parseAnd(): ExpressionNode {
    let left = parseNot();
    while (isKeyword(peek(), 'AND')) {
      next();
      left = { type: 'binary', op: 'And', left, right: parseNot() };
    }
    return left;
  }

  function parseNot(): ExpressionNode {
    if (isKeyword(peek(), 'NOT')) {
      next();
      return { type: 'unary', op: 'Not', operand: parseNot() };
    }
    return parseComparison();
  }

  function parseComparison(): ExpressionNode {
    let left = parseConcat();
    while (peek()?.type === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes((peek() as { value: string }).value)) {
      const op = (next() as { value: string }).value;
      left = { type: 'binary', op, left, right: parseConcat() };
    }
    return left;
  }

  function parseConcat(): ExpressionNode {
    let left = parseAdditive();
    while (peek()?.type === 'op' && (peek() as { value: string }).value === '&') {
      next();
      left = { type: 'binary', op: '&', left, right: parseAdditive() };
    }
    return left;
  }

  function parseAdditive(): ExpressionNode {
    let left = parseMultiplicative();
    while (peek()?.type === 'op' && ['+', '-'].includes((peek() as { value: string }).value)) {
      const op = (next() as { value: string }).value;
      left = { type: 'binary', op, left, right: parseMultiplicative() };
    }
    return left;
  }

  function parseMultiplicative(): ExpressionNode {
    let left = parsePower();
    while (peek()?.type === 'op' && ['*', '/'].includes((peek() as { value: string }).value)) {
      const op = (next() as { value: string }).value;
      left = { type: 'binary', op, left, right: parsePower() };
    }
    return left;
  }

  function parsePower(): ExpressionNode {
    const left = parseUnary();
    if (peek()?.type === 'op' && (peek() as { value: string }).value === '^') {
      next();
      // Right-associative
      return { type: 'binary', op: '^', left, right: parsePower() };
    }
    return left;
  }

  function parseUnary(): ExpressionNode {
    if (peek()?.type === 'op' && (peek() as { value: string }).value === '-') {
      next();
      return { type: 'unary', op: '-', operand: parseUnary() };
    }
    return parsePrimary();
  }

  function parsePrimary(): ExpressionNode {
    const token = next();

    if (token.type === 'number') return { type: 'literal', value: Number(token.value) };
    if (token.type === 'string') return { type: 'literal', value: token.value };
    if (token.type === 'ref') return { type: 'identifier', name: token.value };

    if (token.type === 'ident') {
      const upper = token.value.toUpperCase();
      if (upper === 'TRUE') return { type: 'literal', value: true };
      if (upper === 'FALSE') return { type: 'literal', value: false };

      if (peek()?.type === 'lparen') {
        next();
        const args: ExpressionNode[] = [];
        if (peek()?.type !== 'rparen') {
          args.push(parseOr());
          while (peek()?.type === 'comma') {
            next();
            args.push(parseOr());
          }
        }
        if (next().type !== 'rparen') throw new Error(`Missing ) after ${token.value}(…`);
        return { type: 'call', name: token.value, args };
      }
      throw new Error(`Unexpected identifier "${token.value}" — data items need [brackets]`);
    }

    if (token.type === 'lparen') {
      const inner = parseOr();
      if (next().type !== 'rparen') throw new Error('Missing closing parenthesis');
      return inner;
    }

    throw new Error('Unexpected token');
  }

  const result = parseOr();
  if (position < tokens.length) throw new Error('Unexpected trailing input');
  return result;
}

// ---------------------------------------------------------------------------
// VB emitter
// ---------------------------------------------------------------------------

const PRECEDENCE: Record<string, number> = {
  Or: 1,
  And: 2,
  '=': 4,
  '<>': 4,
  '<': 4,
  '>': 4,
  '<=': 4,
  '>=': 4,
  '&': 5,
  '+': 6,
  '-': 6,
  '*': 7,
  '/': 7,
  '^': 8,
};

/** Argument-shaped nodes that can take a postfix `.Member` without parens. */
const POSTFIX_SAFE = new Set(['identifier', 'call']);

type Flag = (message: string) => void;

interface EmitHelpers {
  arg: (index: number) => string;
  argNode: (index: number) => ExpressionNode | undefined;
  postfixArg: (index: number) => string;
  flag: Flag;
  original: string;
  all: () => string;
}

/** BP function name (lowercase) → VB emitter. */
const FUNCTIONS: Record<string, (h: EmitHelpers) => string> = {
  len: (h) => `${h.postfixArg(0)}.Length`,
  upper: (h) => `${h.postfixArg(0)}.ToUpper()`,
  lower: (h) => `${h.postfixArg(0)}.ToLower()`,
  trim: (h) => `${h.postfixArg(0)}.Trim()`,
  trimstart: (h) => `${h.postfixArg(0)}.TrimStart()`,
  trimend: (h) => `${h.postfixArg(0)}.TrimEnd()`,
  left: (h) => `Left(${h.all()})`,
  right: (h) => `Right(${h.all()})`,
  mid: (h) => `Mid(${h.all()})`,
  instr: (h) => `InStr(${h.all()})`,
  replace: (h) => `Replace(${h.all()})`,
  chr: (h) => `Chr(${h.all()})`,
  asc: (h) => `Asc(${h.all()})`,
  isnumber: (h) => `IsNumeric(${h.arg(0)})`,
  startswith: (h) => `${h.postfixArg(0)}.StartsWith(${h.arg(1)})`,
  endswith: (h) => `${h.postfixArg(0)}.EndsWith(${h.arg(1)})`,
  contains: (h) => `${h.postfixArg(0)}.Contains(${h.arg(1)})`,
  abs: (h) => `Math.Abs(${h.arg(0)})`,
  sqrt: (h) => `Math.Sqrt(${h.arg(0)})`,
  log: (h) => `Math.Log(${h.arg(0)})`,
  round: (h) => `Math.Round(${h.all()})`,
  rndup: (h) => `Math.Ceiling(${h.arg(0)})`,
  rnddn: (h) => `Math.Floor(${h.arg(0)})`,
  now: () => 'DateTime.Now',
  today: () => 'DateTime.Today',
  newline: () => 'Environment.NewLine',
  // Recovery-context functions: `exception` is the TryCatch delegate argument
  // that the page-level Recover/Resume conversion always names `exception`.
  exceptiondetail: () => 'exception.Message',
  exceptiontype: () => 'exception.GetType().Name',
  exceptionstage: (h) => {
    h.flag('ExceptionStage() has no UiPath equivalent — stage names are not tracked at runtime');
    return '"(unavailable after migration)"';
  },
  tonumber: (h) => `CDbl(${h.arg(0)})`,
  todate: (h) => `CDate(${h.arg(0)})`,
  formatdate: (h) => `${h.postfixArg(0)}.ToString(${h.arg(1)})`,
  formatdatetime: (h) => `${h.postfixArg(0)}.ToString(${h.arg(1)})`,
  dateadd: (h) => {
    const interval = h.argNode(0);
    const methods: Record<string, string> = {
      yyyy: 'AddYears',
      m: 'AddMonths',
      d: 'AddDays',
      h: 'AddHours',
      n: 'AddMinutes',
      s: 'AddSeconds',
    };
    if (interval?.type === 'literal' && typeof interval.value === 'string') {
      const key = interval.value.replaceAll('"', '').toLowerCase();
      const method = methods[key];
      if (method) return `${h.postfixArg(2)}.${method}(${h.arg(1)})`;
      // BL-015: calendar intervals without a DateTime method → native VB DateAdd
      const calendar: Record<string, string> = {
        q: 'DateInterval.Quarter',
        ww: 'DateInterval.WeekOfYear',
        w: 'DateInterval.Weekday',
        y: 'DateInterval.DayOfYear',
      };
      if (calendar[key] !== undefined) {
        return `DateAdd(${calendar[key]}, ${h.arg(1)}, ${h.arg(2)})`;
      }
    }
    h.flag(`DateAdd interval not recognized — verify manually: ${h.original}`);
    return `DateAdd(${h.all()})`;
  },
  datediff: (h) => {
    // BL-015: full interval set. TimeSpan components where they exist;
    // calendar intervals (months/years/weeks) via VB.NET's native DateDiff.
    const interval = h.argNode(0);
    if (interval?.type === 'literal' && typeof interval.value === 'string') {
      const key = interval.value.replaceAll('"', '').toLowerCase();
      const spans: Record<string, string> = {
        d: 'TotalDays',
        h: 'TotalHours',
        n: 'TotalMinutes',
        s: 'TotalSeconds',
      };
      if (spans[key] !== undefined) {
        return `CInt((${h.arg(2)} - ${h.arg(1)}).${spans[key]})`;
      }
      const calendar: Record<string, string> = {
        yyyy: 'DateInterval.Year',
        q: 'DateInterval.Quarter',
        m: 'DateInterval.Month',
        ww: 'DateInterval.WeekOfYear',
        w: 'DateInterval.Weekday',
      };
      if (calendar[key] !== undefined) {
        return `CInt(DateDiff(${calendar[key]}, ${h.arg(1)}, ${h.arg(2)}))`;
      }
    }
    h.flag(`DateDiff interval not supported yet — verify manually: ${h.original}`);
    return `DateDiff(${h.all()})`;
  },
};

function emit(
  node: ExpressionNode,
  parentPrecedence: number,
  options: TranslateOptions,
  issues: string[],
): string {
  switch (node.type) {
    case 'literal':
      if (typeof node.value === 'boolean') return node.value ? 'True' : 'False';
      return String(node.value);

    case 'identifier': {
      const ref = node.name;
      const dot = ref.indexOf('.');
      if (dot === -1) {
        const resolved = options.resolveRef?.(ref);
        if (resolved !== undefined) return resolved;
        issues.push(`Unknown data item reference [${ref}]`);
        return sanitizeIdentifier(ref);
      }
      const base = ref.slice(0, dot);
      const field = ref.slice(dot + 1);
      if (options.loop && options.loop.collectionName === base) {
        issues.push(
          `Collection field [${ref}] mapped to ${options.loop.rowVar}("${field}") — verify the field's type usage`,
        );
        return `${options.loop.rowVar}("${field}")`;
      }
      const baseId = options.resolveRef?.(base) ?? sanitizeIdentifier(base);
      issues.push(
        `Single-row collection access [${ref}] mapped to ${baseId}.Rows(0)("${field}") — verify`,
      );
      return `${baseId}.Rows(0)("${field}")`;
    }

    case 'unary': {
      const operand = emit(node.operand, 9, options, issues);
      return node.op === 'Not' ? `Not ${operand}` : `-${operand}`;
    }

    case 'binary': {
      const precedence = PRECEDENCE[node.op] ?? 4;
      // ^ is right-associative: a left-side power needs parens.
      const leftNeedsBump = node.op === '^';
      const left = emit(node.left, leftNeedsBump ? precedence + 1 : precedence, options, issues);
      // Right side of -, /: equal precedence must keep parens (a - (b - c))
      const rightNeedsBump = node.op === '-' || node.op === '/';
      const right = emit(node.right, rightNeedsBump ? precedence + 1 : precedence, options, issues);
      const text = `${left} ${node.op} ${right}`;
      return precedence < parentPrecedence ? `(${text})` : text;
    }

    case 'call': {
      const emitArg = (arg: ExpressionNode): string => emit(arg, 0, options, issues);
      const helpers: EmitHelpers = {
        arg: (i) => (node.args[i] ? emitArg(node.args[i]!) : '""'),
        argNode: (i) => node.args[i],
        postfixArg: (i) => {
          const argNode = node.args[i];
          if (!argNode) return '""';
          const emitted = emitArg(argNode);
          return POSTFIX_SAFE.has(argNode.type) ||
            (argNode.type === 'literal' && typeof argNode.value === 'string')
            ? emitted
            : `(${emitted})`;
        },
        flag: (message) => issues.push(message),
        original: `${node.name}(…)`,
        all: () => node.args.map(emitArg).join(', '),
      };

      const fn = FUNCTIONS[node.name.toLowerCase()];
      if (fn) return fn(helpers);

      issues.push(`Unknown function "${node.name}" — passed through, verify manually`);
      return `${node.name}(${helpers.all()})`;
    }
  }
}
