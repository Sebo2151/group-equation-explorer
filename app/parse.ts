/**
 * The restricted expression parser.
 *
 * Accepted grammar, and nothing else:
 *
 *     expression := factor+
 *     factor     := atom ( '^' exponent )?
 *     atom       := generator | 'e' | '(' expression ')'
 *     generator  := letter digit*
 *     exponent   := '-'? digit+   , optionally wrapped in braces
 *
 * Products are written by juxtaposition — `ab`, `a b`, `(ab)^-1 c` — with `*`
 * and `·` accepted as optional separators. A generator is one letter followed
 * by digits, so `r2` is a generator and `a^2` is a power; juxtaposition is
 * never ambiguous. `e` names the identity and cannot name a generator.
 *
 * Input is never evaluated, and nothing here reaches KaTeX except a generator
 * name that already matched the narrow pattern in `term.ts`.
 */

import {
  generator,
  identity,
  MAX_DEPTH,
  MAX_EXPONENT,
  MAX_NODES,
  nodeCount,
  power,
  product,
  type Term,
} from './term.ts';

/** Bounds the work a single parse can cause, before any structure is built. */
export const MAX_INPUT_LENGTH = 240;

const MAX_EXPONENT_DIGITS = 3;

export class ParseError extends Error {
  readonly position: number;

  constructor(message: string, position: number) {
    super(message);
    this.name = 'ParseError';
    this.position = position;
  }
}

const SEPARATORS = new Set([' ', '\t', '\n', '\r', '*', '·', '⋅']);

function isLetter(character: string | undefined): boolean {
  return character !== undefined && /^[A-Za-z]$/.test(character);
}

function isDigit(character: string | undefined): boolean {
  return character !== undefined && character >= '0' && character <= '9';
}

function isSpace(character: string | undefined): boolean {
  return character !== undefined && /^\s$/.test(character);
}

class Reader {
  private position = 0;
  private readonly text: string;

  constructor(text: string) {
    this.text = text;
  }

  get index(): number {
    return this.position;
  }

  peek(offset = 0): string | undefined {
    return this.text[this.position + offset];
  }

  next(): string | undefined {
    return this.text[this.position++];
  }

  atEnd(): boolean {
    return this.position >= this.text.length;
  }

  slice(start: number): string {
    return this.text.slice(start, this.position);
  }

  skipSpace(): void {
    while (isSpace(this.peek())) this.position += 1;
  }

  skipSeparators(): void {
    while (!this.atEnd() && SEPARATORS.has(this.peek() as string)) this.position += 1;
  }

  fail(message: string, position = this.position): never {
    throw new ParseError(message, position);
  }
}

export function parseTerm(text: unknown, where = 'expression'): Term {
  if (typeof text !== 'string') {
    throw new ParseError(`${where} must be text.`, 0);
  }
  if (text.length > MAX_INPUT_LENGTH) {
    throw new ParseError(`${where} is longer than ${MAX_INPUT_LENGTH} characters.`, MAX_INPUT_LENGTH);
  }

  const reader = new Reader(text);
  const term = readExpression(reader, 0);

  reader.skipSeparators();
  if (!reader.atEnd()) {
    reader.fail(
      reader.peek() === ')'
        ? 'Closing parenthesis with nothing open.'
        : `Unexpected character ${JSON.stringify(reader.peek())}.`,
    );
  }

  // Depth is enforced as the parser descends; the node budget can only be
  // known once the whole term exists.
  if (nodeCount(term) > MAX_NODES) {
    throw new ParseError(`${where} has more than ${MAX_NODES} parts.`, 0);
  }

  return term;
}

export type ParseResult =
  | { ok: true; term: Term }
  | { ok: false; message: string; position: number };

/** Parsing as a value rather than an exception, for live input feedback. */
export function tryParseTerm(text: string, where = 'expression'): ParseResult {
  try {
    return { ok: true, term: parseTerm(text, where) };
  } catch (error) {
    if (error instanceof ParseError) {
      return { ok: false, message: error.message, position: error.position };
    }
    throw error;
  }
}

function readExpression(reader: Reader, depth: number): Term {
  const factors: Term[] = [];
  const start = reader.index;

  for (;;) {
    reader.skipSeparators();
    if (reader.atEnd() || reader.peek() === ')') break;
    factors.push(readFactor(reader, depth));
  }

  if (factors.length === 0) {
    if (depth > 0 && reader.atEnd()) reader.fail('Missing a closing parenthesis.');
    reader.fail(
      start === 0 && reader.atEnd() ? 'Enter an expression.' : 'Expected an expression here.',
    );
  }

  return product(factors);
}

function readFactor(reader: Reader, depth: number): Term {
  let term = readAtom(reader, depth);

  reader.skipSpace();
  if (reader.peek() === '^') {
    reader.next();
    term = power(term, readExponent(reader));

    reader.skipSpace();
    if (reader.peek() === '^') {
      // `a^2^3` has no agreed reading. Ask for the parentheses rather than
      // guessing at an association the learner did not write.
      reader.fail('Write a repeated power with parentheses, such as (a^2)^3.');
    }
  }

  return term;
}

function readAtom(reader: Reader, depth: number): Term {
  if (depth >= MAX_DEPTH) {
    reader.fail(`Expression is nested deeper than ${MAX_DEPTH} levels.`);
  }

  const character = reader.peek();

  if (character === '(') {
    reader.next();
    const inner = readExpression(reader, depth + 1);
    reader.skipSeparators();
    if (reader.peek() !== ')') reader.fail('Missing a closing parenthesis.');
    reader.next();
    return inner;
  }

  if (isLetter(character)) {
    const start = reader.index;
    reader.next();
    while (isDigit(reader.peek())) reader.next();
    const name = reader.slice(start);

    // `e` is the identity, so no generator may be spelled with it — including
    // `e2`, which would be indistinguishable from the identity on screen.
    if (/^[eE][0-9]*$/.test(name)) {
      if (name === 'e') return identity();
      reader.fail(`"${name}" is not allowed: e names the identity.`, start);
    }

    return generator(name);
  }

  if (character === undefined) reader.fail('Expression ends too early.');
  if (character === '^') reader.fail('A power needs something to apply to.');
  reader.fail(`Unexpected character ${JSON.stringify(character)}.`);
}

function readExponent(reader: Reader): number {
  reader.skipSpace();

  const braced = reader.peek() === '{';
  if (braced) {
    reader.next();
    reader.skipSpace();
  }

  let negative = false;
  if (reader.peek() === '-') {
    reader.next();
    reader.skipSpace();
    negative = true;
  }

  let digits = '';
  while (isDigit(reader.peek())) {
    digits += reader.next();
    if (digits.length > MAX_EXPONENT_DIGITS) reader.fail('Exponent is too large.');
  }

  if (digits.length === 0) reader.fail('A power needs a whole-number exponent.');

  if (braced) {
    reader.skipSpace();
    if (reader.peek() !== '}') reader.fail('Missing a closing brace after the exponent.');
    reader.next();
  }

  const magnitude = Number.parseInt(digits, 10);
  if (magnitude > MAX_EXPONENT) {
    reader.fail(`Exponent magnitude must be at most ${MAX_EXPONENT}.`);
  }

  return negative ? -magnitude : magnitude;
}
