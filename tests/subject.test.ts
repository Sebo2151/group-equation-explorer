import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  equation,
  expression,
  isEquation,
  replaceSide,
  sideTerm,
  subjectDepth,
  subjectNodeCount,
  subjectSource,
  subjectSpeech,
  subjectTerms,
  subjectTex,
  subjectsEqual,
  validateSubject,
} from '../app/subject.ts';
import { generator, identity, inverse, product } from '../app/term.ts';

const a = generator('a');
const b = generator('b');
const x = generator('x');

/* Construction ---------------------------------------------------------- */

test('an expression and an equation are different kinds of subject', () => {
  assert.equal(isEquation(expression(a)), false);
  assert.equal(isEquation(equation(a, b)), true);
  assert.deepEqual(subjectTerms(expression(a)), [a]);
  assert.deepEqual(subjectTerms(equation(a, b)), [a, b]);
});

test('a side can be read and replaced without mutating the equation', () => {
  const original = equation(product([a, x]), b);
  assert.deepEqual(sideTerm(original, 'left'), product([a, x]));
  assert.deepEqual(sideTerm(original, 'right'), b);

  const replaced = replaceSide(original, 'left', x);
  assert.deepEqual(replaced, equation(x, b));
  assert.deepEqual(original, equation(product([a, x]), b));
});

/* Equality -------------------------------------------------------------- */

test('an expression is never equal to an equation', () => {
  assert.equal(subjectsEqual(expression(a), equation(a, a)), false);
});

test('equation equality is structural on both sides', () => {
  assert.equal(subjectsEqual(equation(a, b), equation(a, b)), true);
  assert.equal(subjectsEqual(equation(a, b), equation(a, x)), false);
});

/**
 * The decision that symmetry stays a step worth taking. If this ever passes,
 * `symmetry` has become unreachable in every solving challenge.
 */
test('swapping the sides gives a different subject, so symmetry still costs a step', () => {
  assert.equal(subjectsEqual(equation(x, product([inverse(a), b])), equation(product([inverse(a), b]), x)), false);
});

/* Size ------------------------------------------------------------------ */

test('an equation is sized as both of its sides', () => {
  const subject = equation(product([a, b]), x);
  // product node + two generators on the left, one generator on the right.
  assert.equal(subjectNodeCount(subject), 4);
  assert.equal(subjectNodeCount(expression(x)), 1);
});

test('depth is the deeper side, not the sum', () => {
  assert.equal(subjectDepth(equation(inverse(inverse(a)), b)), 3);
});

/* Validation ------------------------------------------------------------ */

test('validateSubject accepts what the model builds', () => {
  const subject = equation(product([a, inverse(b)]), identity());
  assert.deepEqual(validateSubject(subject), subject);
  assert.deepEqual(validateSubject(expression(a)), expression(a));
});

test('validateSubject rejects malformed data', () => {
  assert.throws(() => validateSubject(null), /expected a subject object/);
  assert.throws(() => validateSubject([]), /expected a subject object/);
  assert.throws(() => validateSubject({ kind: 'inequality' }), /unknown subject kind/);
  assert.throws(() => validateSubject({ kind: 'equation', left: a }), /expected a term object/);
});

test('each side of an equation is validated as a term', () => {
  assert.throws(
    () => validateSubject({ kind: 'equation', left: { kind: 'generator', name: 'e' }, right: a }),
    /reserved for the identity/,
  );
  assert.throws(
    () => validateSubject({ kind: 'equation', left: a, right: { kind: 'product', factors: [a] } }),
    /at least two factors/,
  );
});

/* Renderings ------------------------------------------------------------ */

test('an equation typesets with a relation between the sides', () => {
  assert.equal(subjectTex(equation(product([a, x]), b)), 'ax = b');
  assert.equal(subjectTex(expression(a)), 'a');
});

test('spoken forms never contain TeX', () => {
  const spoken = subjectSpeech(equation(product([a, x]), inverse(b)));
  assert.equal(spoken, 'a times x equals b inverse');
  assert.doesNotMatch(spoken, /\\|[{}^]/);
});

test('source round trips through the canonical form', () => {
  assert.equal(subjectSource(equation(product([a, x]), b)), 'a x = b');
  assert.equal(subjectSource(expression(inverse(a))), 'a^-1');
});
