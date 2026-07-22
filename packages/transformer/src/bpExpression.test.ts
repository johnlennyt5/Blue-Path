import { describe, expect, it } from 'vitest';
import { translateBpExpression } from './bpExpression';

/** Standard resolver: every plain ref resolves to its sanitized identifier. */
const resolve = (name: string): string => name.trim().replace(/[^A-Za-z0-9_]+/g, '_');

function vb(bp: string): string {
  const result = translateBpExpression(bp, { resolveRef: resolve });
  expect(result.issues, `unexpected issues for: ${bp}`).toEqual([]);
  expect(result.ok).toBe(true);
  return result.vb;
}

/** [bp, expected vb] — must translate cleanly with zero issues. */
const CLEAN: [string, string][] = [
  // --- literals (12)
  ['1', '1'],
  ['123', '123'],
  ['1.5', '1.5'],
  ['.5', '0.5'],
  ['0', '0'],
  ['"hello"', '"hello"'],
  ['""', '""'],
  ['"a ""quoted"" word"', '"a ""quoted"" word"'],
  ['True', 'True'],
  ['FALSE', 'False'],
  ['true', 'True'],
  ['"AND"', '"AND"'],
  // --- data item references (8)
  ['[A]', 'A'],
  ['[Total Value]', 'Total_Value'],
  ['[ A ]', 'A'],
  ['[Customer SSN]', 'Customer_SSN'],
  ['[x1]', 'x1'],
  ['[Amount]', 'Amount'],
  ['[Run Date]', 'Run_Date'],
  ['[A]&[B]', 'A & B'],
  // --- arithmetic & precedence (22)
  ['1 + 2', '1 + 2'],
  ['1+2*3', '1 + 2 * 3'],
  ['(1+2)*3', '(1 + 2) * 3'],
  ['[A] - [B] - [C]', 'A - B - C'],
  ['[A] - ([B] - [C])', 'A - (B - C)'],
  ['[A] / [B] / [C]', 'A / B / C'],
  ['[A] / ([B] / [C])', 'A / (B / C)'],
  ['2 ^ 3', '2 ^ 3'],
  ['2 ^ 3 ^ 2', '2 ^ 3 ^ 2'],
  ['(2 ^ 3) ^ 2', '(2 ^ 3) ^ 2'],
  ['-[A]', '-A'],
  ['-[A] + [B]', '-A + B'],
  ['[A] * -1', 'A * -1'],
  ['10 / 2', '10 / 2'],
  ['[Net] + [Tax]', 'Net + Tax'],
  ['[Annual Rate] / 12 / 100', 'Annual_Rate / 12 / 100'],
  ['1 + 2 + 3', '1 + 2 + 3'],
  ['[A]*([B]+[C])', 'A * (B + C)'],
  ['([A])', 'A'],
  ['((1))', '1'],
  ['[N] ^ 2 + [M] ^ 2', 'N ^ 2 + M ^ 2'],
  ['2 * -3', '2 * -3'],
  // --- concatenation (10)
  ['"a" & "b"', '"a" & "b"'],
  ['[A] & ", " & [B]', 'A & ", " & B'],
  ['"n=" & 1 + 2', '"n=" & 1 + 2'],
  ['[Name] & NewLine() & [City]', 'Name & Environment.NewLine & City'],
  ['"total: " & [Total]', '"total: " & Total'],
  ['[A] & ""', 'A & ""'],
  ['"" & [A]', '"" & A'],
  ['[First] & " " & [Last]', 'First & " " & Last'],
  ['1 & 2', '1 & 2'],
  ['"x" & 1 & "y"', '"x" & 1 & "y"'],
  // --- comparison (14)
  ['[A] = 1', 'A = 1'],
  ['[A] <> ""', 'A <> ""'],
  ['[A] < [B]', 'A < B'],
  ['[A] >= 10', 'A >= 10'],
  ['[A] <= [B]', 'A <= B'],
  ['[A] > 0', 'A > 0'],
  ['1 + 2 = 3', '1 + 2 = 3'],
  ['[A] = [B] & "x"', 'A = B & "x"'],
  ['"a" = "a"', '"a" = "a"'],
  ['[Flag] = True', 'Flag = True'],
  ['[D] > Now()', 'D > DateTime.Now'],
  ['Len([A]) = 0', 'A.Length = 0'],
  ['[A] <> [B]', 'A <> B'],
  ['2 >= 2', '2 >= 2'],
  // --- logical (14)
  ['[A] > 0 AND [B] > 0', 'A > 0 And B > 0'],
  ['([A] > 0) AND ([B] > 0)', 'A > 0 And B > 0'],
  ['[A] AND [B] OR [C]', 'A And B Or C'],
  ['[A] OR [B] AND [C]', 'A Or B And C'],
  ['NOT [A]', 'Not A'],
  ['NOT [A] AND [B]', 'Not A And B'],
  ['NOT ([A] AND [B])', 'Not (A And B)'],
  ['[A] and [B]', 'A And B'],
  ['[a] Or [b]', 'a Or b'],
  ['True AND False', 'True And False'],
  ['[Valid] = True AND [Count] > 0', 'Valid = True And Count > 0'],
  ['NOT True', 'Not True'],
  ['[A] OR NOT [B]', 'A Or Not B'],
  ['([A] OR [B]) AND [C]', '(A Or B) And C'],
  // --- string functions (33)
  ['Len([Name])', 'Name.Length'],
  ['Len("abc")', '"abc".Length'],
  ['Len([A] & [B])', '(A & B).Length'],
  ['Len(Trim([A]))', 'A.Trim().Length'],
  ['Len("")', '"".Length'],
  ['Upper([Name])', 'Name.ToUpper()'],
  ['Lower([Name])', 'Name.ToLower()'],
  ['Upper("abc")', '"abc".ToUpper()'],
  ['Lower([A] & [B])', '(A & B).ToLower()'],
  ['Trim([A])', 'A.Trim()'],
  ['TrimStart([A])', 'A.TrimStart()'],
  ['TrimEnd([A])', 'A.TrimEnd()'],
  ['Trim(" x ")', '" x ".Trim()'],
  ['Left([Name], 3)', 'Left(Name, 3)'],
  ['Right([Name], 2)', 'Right(Name, 2)'],
  ['Mid([Name], 2, 3)', 'Mid(Name, 2, 3)'],
  ['Left([A] & [B], 1)', 'Left(A & B, 1)'],
  ['Mid([S], [I], 1)', 'Mid(S, I, 1)'],
  ['InStr([Hay], [Needle])', 'InStr(Hay, Needle)'],
  ['InStr([A], "x")', 'InStr(A, "x")'],
  ['Replace([S], "a", "b")', 'Replace(S, "a", "b")'],
  ['Chr(34)', 'Chr(34)'],
  ['Asc("A")', 'Asc("A")'],
  ['IsNumber([A])', 'IsNumeric(A)'],
  ['StartsWith([A], "x")', 'A.StartsWith("x")'],
  ['EndsWith([A], "x")', 'A.EndsWith("x")'],
  ['Contains([A], "x")', 'A.Contains("x")'],
  ['Upper(Left([Name], 1)) & Lower(Mid([Name], 2))', 'Left(Name, 1).ToUpper() & Mid(Name, 2).ToLower()'],
  ['Len([A]) + Len([B])', 'A.Length + B.Length'],
  ['Trim(Upper([A]))', 'A.ToUpper().Trim()'],
  ['Replace(Trim([S]), " ", "")', 'Replace(S.Trim(), " ", "")'],
  ['LEN([A])', 'A.Length'],
  ['LeFt([A], 2)', 'Left(A, 2)'],
  // --- math functions (16)
  ['Abs([A])', 'Math.Abs(A)'],
  ['Sqrt([A])', 'Math.Sqrt(A)'],
  ['Log([A])', 'Math.Log(A)'],
  ['Round([A], 2)', 'Math.Round(A, 2)'],
  ['Round([A])', 'Math.Round(A)'],
  ['RndUp([A])', 'Math.Ceiling(A)'],
  ['RndDn([A])', 'Math.Floor(A)'],
  ['Abs(-5)', 'Math.Abs(-5)'],
  ['Round([A] * [B], 2)', 'Math.Round(A * B, 2)'],
  ['Sqrt([A] + [B])', 'Math.Sqrt(A + B)'],
  ['Abs([A]) + Abs([B])', 'Math.Abs(A) + Math.Abs(B)'],
  ['Round(1.005, 2)', 'Math.Round(1.005, 2)'],
  ['RndUp([Total] / 12)', 'Math.Ceiling(Total / 12)'],
  ['Sqrt(2)', 'Math.Sqrt(2)'],
  ['Log(10) * 2', 'Math.Log(10) * 2'],
  ['-Sqrt([A])', '-Math.Sqrt(A)'],
  // --- date & conversion functions (21)
  ['Now()', 'DateTime.Now'],
  ['Today()', 'DateTime.Today'],
  ['DateAdd("d", 1, [D])', 'D.AddDays(1)'],
  ['DateAdd("m", 2, [D])', 'D.AddMonths(2)'],
  ['DateAdd("yyyy", 1, [D])', 'D.AddYears(1)'],
  ['DateAdd("h", 3, [D])', 'D.AddHours(3)'],
  ['DateAdd("n", 30, [D])', 'D.AddMinutes(30)'],
  ['DateAdd("s", 10, [D])', 'D.AddSeconds(10)'],
  ['DateAdd("d", -1, [D])', 'D.AddDays(-1)'],
  ['DateAdd("d", 1, Today())', 'DateTime.Today.AddDays(1)'],
  ['DateAdd("d", 7, [Run Date])', 'Run_Date.AddDays(7)'],
  ['DateDiff("d", [Start Date], [End Date])', 'CInt((End_Date - Start_Date).TotalDays)'],
  ['FormatDate([D], "dd/MM/yyyy")', 'D.ToString("dd/MM/yyyy")'],
  ['FormatDateTime([D], "g")', 'D.ToString("g")'],
  ['Now() > [Deadline]', 'DateTime.Now > Deadline'],
  ['FormatDate(Now(), "yyyy")', 'DateTime.Now.ToString("yyyy")'],
  ['FormatDate(DateAdd("d", 1, [D]), "dd/MM")', 'D.AddDays(1).ToString("dd/MM")'],
  ['ToDate([S])', 'CDate(S)'],
  ['ToNumber([S])', 'CDbl(S)'],
  ['ToNumber("42")', 'CDbl("42")'],
  ['ToNumber([A]) + 1', 'CDbl(A) + 1'],
  // --- realistic composites (24)
  [
    '([Principal] + ([Principal] * [Monthly Rate] * [Term Months])) / [Term Months]',
    '(Principal + Principal * Monthly_Rate * Term_Months) / Term_Months',
  ],
  ['[Total] * 1', 'Total * 1'],
  ['[Session Age] + 1', 'Session_Age + 1'],
  ['Len(Trim([Work SSN])) = 11', 'Work_SSN.Trim().Length = 11'],
  ['"Bearer " & [Service API Key]', '"Bearer " & Service_API_Key'],
  ['[Item ID] <> ""', 'Item_ID <> ""'],
  ['Upper([First]) & " " & Upper([Last])', 'First.ToUpper() & " " & Last.ToUpper()'],
  ['[Qty] * [Price] * (1 + [VAT Rate])', 'Qty * Price * (1 + VAT_Rate)'],
  ['Round([Qty] * [Price], 2) & " GBP"', 'Math.Round(Qty * Price, 2) & " GBP"'],
  ['IsNumber([Input]) AND ToNumber([Input]) > 0', 'IsNumeric(Input) And CDbl(Input) > 0'],
  ['[Count] >= 1 AND [Count] <= 10', 'Count >= 1 And Count <= 10'],
  ['NOT IsNumber([X])', 'Not IsNumeric(X)'],
  ['Left([Postcode], InStr([Postcode], " "))', 'Left(Postcode, InStr(Postcode, " "))'],
  ['[A] = "" OR [B] = ""', 'A = "" Or B = ""'],
  ['Mid([S], 1, Len([S]) - 1)', 'Mid(S, 1, S.Length - 1)'],
  ['Chr(34) & [A] & Chr(34)', 'Chr(34) & A & Chr(34)'],
  ['[Amount] < 0.01', 'Amount < 0.01'],
  ['-1 * [A]', '-1 * A'],
  ['[Flag]', 'Flag'],
  ['Trim([A]) <> ""', 'A.Trim() <> ""'],
  ['Sqrt([N] ^ 2 + [M] ^ 2)', 'Math.Sqrt(N ^ 2 + M ^ 2)'],
  ['((([X])))', 'X'],
  ['[X]>=0AND[Y]>=0', 'X >= 0 And Y >= 0'],
  ['1+2=3 AND 4>2', '1 + 2 = 3 And 4 > 2'],
  // --- whitespace tolerance (6)
  ['  1 + 2  ', '1 + 2'],
  ['1+1', '1 + 1'],
  ['Upper( [Name] )', 'Name.ToUpper()'],
  ['Len ([A])', 'A.Length'],
  ['[ Name ]', 'Name'],
  ['InStr([A], [B]) > 0', 'InStr(A, B) > 0'],
];

describe(`clean translations (${CLEAN.length} cases)`, () => {
  it.each(CLEAN)('%s → %s', (bp, expected) => {
    expect(vb(bp)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Flagged — translated best-effort but NEVER silently wrong
// ---------------------------------------------------------------------------

interface FlaggedCase {
  bp: string;
  vbContains?: string;
  issueContains: string;
}

const FLAGGED: FlaggedCase[] = [
  { bp: 'Foo([A])', vbContains: 'Foo(A)', issueContains: 'Unknown function "Foo"' },
  { bp: 'Bar()', vbContains: 'Bar()', issueContains: 'Unknown function "Bar"' },
  { bp: 'MakeDate(2024, 1, 1)', issueContains: 'Unknown function "MakeDate"' },
  { bp: 'DateAdd([Interval], 1, [D])', vbContains: 'DateAdd(', issueContains: 'DateAdd interval' },
  { bp: 'DateAdd("q", 1, [D])', issueContains: 'DateAdd interval' },
  { bp: 'DateDiff("m", [A], [B])', vbContains: 'DateDiff(', issueContains: 'DateDiff interval' },
  {
    bp: '[Coll.Field]',
    vbContains: 'Coll.Rows(0)("Field")',
    issueContains: 'Single-row collection access',
  },
  {
    bp: '"Reconciling " & [Customer Records.SSN]',
    vbContains: 'Customer_Records.Rows(0)("SSN")',
    issueContains: 'Single-row collection access',
  },
  { bp: '[Unclosed', issueContains: 'Unable to parse' },
  { bp: '"unterminated', issueContains: 'Unable to parse' },
  { bp: '1 +', issueContains: 'Unable to parse' },
  { bp: '(', issueContains: 'Unable to parse' },
  { bp: ')', issueContains: 'Unable to parse' },
  { bp: '[A] [B]', issueContains: 'Unable to parse' },
  { bp: '@', issueContains: 'Unable to parse' },
  { bp: 'Name', issueContains: 'Unable to parse' },
  { bp: '1..2', issueContains: 'Unable to parse' },
  { bp: '', issueContains: 'Empty expression' },
  { bp: '   ', issueContains: 'Empty expression' },
  { bp: 'Len([A]', issueContains: 'Unable to parse' },
];

describe(`flagged translations (${FLAGGED.length} cases)`, () => {
  it.each(FLAGGED.map((c) => [c.bp, c] as const))('%s is flagged', (_bp, testCase) => {
    const result = translateBpExpression(testCase.bp, { resolveRef: resolve });
    expect(result.ok).toBe(false);
    expect(result.issues.join(' | ')).toContain(testCase.issueContains);
    if (testCase.vbContains !== undefined) {
      expect(result.vb).toContain(testCase.vbContains);
    }
  });

  it('flags unknown references when the resolver cannot find them', () => {
    const result = translateBpExpression('[Missing Item] + 1', { resolveRef: () => undefined });
    expect(result.ok).toBe(false);
    expect(result.issues[0]).toContain('Unknown data item reference [Missing Item]');
    expect(result.vb).toBe('Missing_Item + 1');
  });
});

// ---------------------------------------------------------------------------
// Loop context — collection field access
// ---------------------------------------------------------------------------

describe('collection field access in loop context', () => {
  const loop = { collectionName: 'Items', rowVar: 'CurrentRow' };

  it('maps active-loop fields to the row variable (flagged for type review)', () => {
    const result = translateBpExpression('[Items.Name]', { resolveRef: resolve, loop });
    expect(result.vb).toBe('CurrentRow("Name")');
    expect(result.issues[0]).toContain('verify');
  });

  it('composes inside larger expressions', () => {
    const result = translateBpExpression('"id: " & [Items.Ref]', { resolveRef: resolve, loop });
    expect(result.vb).toBe('"id: " & CurrentRow("Ref")');
  });

  it('non-active collections still use single-row access', () => {
    const result = translateBpExpression('[Other.Name]', { resolveRef: resolve, loop });
    expect(result.vb).toBe('Other.Rows(0)("Name")');
  });
});

describe('determinism', () => {
  it('same input, same output, always', () => {
    for (const [bp] of CLEAN.slice(0, 20)) {
      const a = translateBpExpression(bp, { resolveRef: resolve });
      const b = translateBpExpression(bp, { resolveRef: resolve });
      expect(a).toEqual(b);
    }
  });
});
