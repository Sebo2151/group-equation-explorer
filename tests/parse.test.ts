import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MAX_INPUT_LENGTH, ParseError, parseTerm, tryParseTerm } from '../app/parse.ts';
import {
  generator,
  identity,
  inverse,
  MAX_EXPONENT,
  power,
  product,
  termSource,
  termsEqual,
  type Term,
} from '../app/term.ts';

const a = generator('a');
const b = generator('b');
const c = generator('c');

function parsed(text: string): Term {
  return parseTerm(text);
}

/* The accepted subset ---------------------------------------------------- */

test('juxtaposition is a product', () => {
  assert.ok(termsEqual(parsed('ab'), product([a, b])));
  assert.ok(termsEqual(parsed('a b'), product([a, b])));
  assert.ok(termsEqual(parsed('a*b'), product([a, b])));
  assert.ok(termsEqual(parsed('a · b'), product([a, b])));
  assert.ok(termsEqual(parsed('  a\tb\nc '), product([a, b, c])));
});

test('a generator is one letter and any digits, so juxtaposition is unambiguous', () => {
  assert.ok(termsEqual(parsed('r2'), generator('r2')));
  assert.ok(termsEqual(parsed('r2 s'), product([generator('r2'), generator('s')])));
  assert.ok(termsEqual(parsed('a^2'), power(a, 2)));
  assert.ok(termsEqual(parsed('aB'), product([a, generator('B')])));
});

test('e is the identity and cannot name a generator', () => {
  assert.ok(termsEqual(parsed('e'), identity()));
  assert.ok(termsEqual(parsed('a e b'), product([a, identity(), b])));
  assert.throws(() => parsed('e2'), /names the identity/);
});

test('parentheses build nested structure that survives', () => {
  assert.ok(termsEqual(parsed('(ab)^-1'), inverse(product([a, b]))));
  assert.ok(termsEqual(parsed('(ab)c'), product([a, b, c])));
  assert.ok(termsEqual(parsed('a(bc)'), product([a, b, c])));
  // Associativity is structural; these two are the same term.
  assert.ok(termsEqual(parsed('(ab)c'), parsed('a(bc)')));
  // Structure under an inverse is not.
  assert.ok(!termsEqual(parsed('(ab)^-1 c'), parsed('a (b c)^-1')));
});

test('exponents accept a sign and optional braces', () => {
  assert.ok(termsEqual(parsed('a^3'), power(a, 3)));
  assert.ok(termsEqual(parsed('a^-3'), power(a, -3)));
  assert.ok(termsEqual(parsed('a^{-3}'), power(a, -3)));
  assert.ok(termsEqual(parsed('a^{ - 3 }'), power(a, -3)));
  assert.ok(termsEqual(parsed('a^0'), power(a, 0)));
});

test('exponent 1 and -1 are notation, not extra structure', () => {
  assert.ok(termsEqual(parsed('a^1'), a));
  assert.ok(termsEqual(parsed('a^-1'), inverse(a)));
  assert.ok(termsEqual(parsed('a^-1'), parsed('(a)^-1')));
});

test('a repeated power must be written with parentheses', () => {
  assert.throws(() => parsed('a^2^3'), /parentheses/);
  assert.ok(termsEqual(parsed('(a^2)^3'), power(power(a, 2), 3)));
});

/* Rejection -------------------------------------------------------------- */

test('malformed input is rejected with a position', () => {
  const cases: [string, RegExp][] = [
    ['', /Enter an expression/],
    ['   ', /Enter an expression/],
    ['(', /closing parenthesis/],
    ['(ab', /closing parenthesis/],
    ['ab)', /nothing open/],
    ['()', /Expected an expression/],
    ['a^', /whole-number exponent/],
    ['^a', /needs something to apply to/],
    ['a^{2', /closing brace/],
    ['a + b', /Unexpected character/],
    ['a$b', /Unexpected character/],
    ['a^1000', /too large|at most/],
  ];

  for (const [text, message] of cases) {
    assert.throws(
      () => parsed(text),
      (error: unknown) =>
        error instanceof ParseError &&
        message.test(error.message) &&
        Number.isInteger(error.position),
      `expected ${JSON.stringify(text)} to be rejected with ${message}`,
    );
  }
});

test('input is length limited before any structure is built', () => {
  assert.throws(() => parsed('a'.repeat(MAX_INPUT_LENGTH + 1)), /longer than/);
});

test('exponent magnitude is bounded', () => {
  assert.ok(termsEqual(parsed(`a^${MAX_EXPONENT}`), power(a, MAX_EXPONENT)));
  assert.throws(() => parsed(`a^${MAX_EXPONENT + 1}`), /at most/);
});

test('nesting depth is bounded', () => {
  assert.throws(() => parsed('('.repeat(40) + 'a' + ')'.repeat(40)), /nested deeper/);
});

test('nothing that looks like a TeX command survives', () => {
  assert.throws(() => parsed('\\href{javascript:alert(1)}{x}'), /Unexpected character/);
  assert.throws(() => parsed('\\rule{9999em}{9999em}'), /Unexpected character/);
});

/* Round trip ------------------------------------------------------------- */

test('tryParseTerm reports failure as a value', () => {
  const good = tryParseTerm('a b^-1');
  assert.equal(good.ok, true);
  const bad = tryParseTerm('a +');
  assert.equal(bad.ok, false);
  if (!bad.ok) {
    assert.match(bad.message, /Unexpected character/);
    assert.equal(bad.position, 2);
  }
});

test('source text round trips through the parser', () => {
  const terms: Term[] = [
    a,
    identity(),
    product([a, b, c]),
    product([a, inverse(b)]),
    inverse(product([a, b])),
    inverse(inverse(a)),
    power(a, 3),
    power(a, -3),
    power(a, 0),
    power(inverse(a), 4),
    inverse(power(a, 2)),
    product([inverse(product([a, b])), power(product([b, c]), 2), identity()]),
    generator('r2'),
    product([generator('r2'), inverse(generator('s'))]),
  ];

  for (const term of terms) {
    const text = termSource(term);
    assert.ok(
      termsEqual(parsed(text), term),
      `round trip changed ${text} into ${termSource(parsed(text))}`,
    );
    // And it is stable: re-printing the reparsed term gives the same text.
    assert.equal(termSource(parsed(text)), text);
  }
});

test('round trip preserves structure modulo associative flattening only', () => {
  const written = parsed('((ab)c)^-1');
  assert.equal(termSource(written), '(a b c)^-1');
  assert.ok(termsEqual(parsed(termSource(written)), written));
});
