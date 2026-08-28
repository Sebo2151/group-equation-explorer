import assert from 'node:assert/strict';
import { test } from 'node:test';

import { anyRuleById, applyToSubject, findAddresses } from '../app/catalogue.ts';
import { EQUATION_RULE_IDS } from '../app/equation-rules.ts';
import { parseSubject, parseTerm } from '../app/parse.ts';
import { RULE_IDS } from '../app/rules.ts';
import { expression, subjectSource, type Subject } from '../app/subject.ts';
import {
  TEST_GROUPS,
  assignments,
  dihedralGroup,
  equationHolds,
  evaluateTerm,
  generatorNames,
  symmetricGroup,
  type FiniteGroup,
} from './support/finite-group.ts';

const subject = (source: string) => parseSubject(source);

/* The groups themselves --------------------------------------------------- */

test('the test groups are the size they should be, and are not abelian', () => {
  const s3 = symmetricGroup(3);
  const d4 = dihedralGroup(4);

  assert.equal(s3.elements.length, 6);
  assert.equal(d4.elements.length, 8);

  for (const group of [s3, d4]) {
    const pairs = group.elements.flatMap((left) =>
      group.elements.map((right) => [left, right] as const),
    );
    assert.ok(
      pairs.some(([left, right]) => group.multiply(left, right) !== group.multiply(right, left)),
      `${group.name} must not be abelian, or it cannot catch the bug this exists for`,
    );
  }
});

test('the group axioms hold in each test group', () => {
  for (const group of TEST_GROUPS) {
    for (const a of group.elements) {
      assert.equal(group.multiply(group.identity, a), a, `${group.name}: left identity`);
      assert.equal(group.multiply(a, group.identity), a, `${group.name}: right identity`);
      assert.equal(group.multiply(a, group.invert(a)), group.identity, `${group.name}: inverse`);
      assert.equal(group.multiply(group.invert(a), a), group.identity, `${group.name}: inverse`);

      for (const b of group.elements) {
        for (const c of group.elements) {
          assert.equal(
            group.multiply(group.multiply(a, b), c),
            group.multiply(a, group.multiply(b, c)),
            `${group.name}: associativity`,
          );
        }
      }
    }
  }
});

/* The evaluator itself ---------------------------------------------------- */

test('the evaluator respects order, so it can tell wu from uw', () => {
  const s3 = symmetricGroup(3);
  const names = ['w', 'u'];
  const differs = [...assignments(names, s3)].some(
    (assignment) =>
      evaluateTerm(parseTerm('w u'), assignment, s3) !==
      evaluateTerm(parseTerm('u w'), assignment, s3),
  );
  assert.ok(differs, 'the evaluator cannot distinguish orders, so it proves nothing');
});

test('powers, inverses and the identity evaluate as they should', () => {
  const d4 = dihedralGroup(4);
  for (const assignment of assignments(['a'], d4)) {
    const a = assignment.a;
    assert.equal(evaluateTerm(parseTerm('e'), assignment, d4), d4.identity);
    assert.equal(evaluateTerm(parseTerm('a^0'), assignment, d4), d4.identity);
    assert.equal(evaluateTerm(parseTerm('a^3'), assignment, d4), d4.multiply(d4.multiply(a, a), a));
    assert.equal(evaluateTerm(parseTerm('a^-1'), assignment, d4), d4.invert(a));
    assert.equal(evaluateTerm(parseTerm('a^-2'), assignment, d4), d4.invert(d4.multiply(a, a)));
    assert.equal(evaluateTerm(parseTerm('(a^-1)^-1'), assignment, d4), a);
  }
});

/* ------------------------------------------------------------------ */
/* Soundness of the rules                                              */
/* ------------------------------------------------------------------ */

/** Every value a term takes, over every assignment, must be unchanged. */
function assertSameValue(before: Subject, after: Subject, group: FiniteGroup, what: string) {
  const names = [...new Set([...generatorNames(before), ...generatorNames(after)])];
  for (const assignment of assignments(names, group)) {
    if (before.kind === 'expression' && after.kind === 'expression') {
      assert.equal(
        evaluateTerm(after.term, assignment, group),
        evaluateTerm(before.term, assignment, group),
        `${what} changed the value in ${group.name} at ${JSON.stringify(assignment)}: ` +
          `${subjectSource(before)} became ${subjectSource(after)}`,
      );
    } else {
      // An equation is a statement, so what must be preserved is its truth.
      assert.equal(
        equationHolds(after, assignment, group),
        equationHolds(before, assignment, group),
        `${what} changed the truth of the equation in ${group.name} at ` +
          `${JSON.stringify(assignment)}: ${subjectSource(before)} became ${subjectSource(after)}`,
      );
    }
  }
}

/**
 * Every term rule, applied at every place it offers, on a deliberately
 * non-commutative sample. A rewrite that reorders factors it should not — the
 * classic way to get socks-and-shoes or an inverse distribution backwards — is
 * value-changing in S3 and fails here even though its shape is impeccable.
 */
test('every term rule preserves the value of the expression it rewrites', () => {
  const samples = [
    'a a^-1 b',
    'b a a^-1',
    'e a b',
    'a b',
    '(a^-1)^-1 b',
    '(a b)^-1',
    'b^-1 a^-1',
    'e^-1 a',
    'a^3 b',
    'a^2 a^3',
    'a^0 b',
    '(a^2)^-1',
    'a^-2 b',
    '(a b)^-1 a b',
  ];

  for (const group of TEST_GROUPS) {
    for (const source of samples) {
      const start = subject(source);
      for (const rule of RULE_IDS) {
        for (const address of findAddresses(start, rule)) {
          const argument = anyRuleById(rule).needsTerm ? { term: parseTerm('a') } : undefined;
          const result = applyToSubject(start, rule, address, argument);
          assertSameValue(start, result.subject, group, `${rule} on ${source}`);
        }
      }
    }
  }
});

/**
 * The rules this phase adds, and the reason this file exists. `left-multiply`
 * and `right-multiply` differ only in the order of a product; an implementation
 * that built the wrong one would be structurally valid and would still turn a
 * true equation into a false one here.
 */
test('every whole-equation rule preserves the truth of the equation', () => {
  const samples = ['a x = b', 'x a = b', 'a b = b a', 'x = a b', 'a x = a y', 'e = a'];
  const multipliers = ['a', 'b', 'a^-1', 'b^-1', 'x'];

  for (const group of TEST_GROUPS) {
    for (const source of samples) {
      const start = subject(source);
      for (const rule of EQUATION_RULE_IDS) {
        for (const address of findAddresses(start, rule)) {
          const definition = anyRuleById(rule);
          const terms = definition.needsTerm ? multipliers : [null];
          for (const multiplier of terms) {
            const argument = multiplier === null ? undefined : { term: parseTerm(multiplier) };
            const result = applyToSubject(start, rule, address, argument);
            assertSameValue(
              start,
              result.subject,
              group,
              `${rule}${multiplier ? ` by ${multiplier}` : ''} on ${source}`,
            );
          }
        }
      }
    }
  }
});

/**
 * A guard on the guard: deliberately wrong rewrites, checked to be caught.
 * Without this the tests above could be passing because the samples never
 * exercise anything, and would go on passing if the evaluator broke.
 */
test('the soundness check catches a product built in the wrong order', () => {
  const s3 = symmetricGroup(3);

  // Socks and shoes, and the abelian mistake it exists to teach against.
  assert.doesNotThrow(() =>
    assertSameValue(subject('(a b)^-1'), subject('b^-1 a^-1'), s3, 'sanity'),
  );
  assert.throws(
    () => assertSameValue(subject('(a b)^-1'), subject('a^-1 b^-1'), s3, 'inverses not reversed'),
    /changed the value/,
    'a commuted inverse must be caught, or this file protects nothing',
  );
});

test('the soundness check catches an equation multiplied on one side only', () => {
  const s3 = symmetricGroup(3);

  assert.doesNotThrow(() =>
    assertSameValue(subject('a x = b'), subject('w a x = w b'), s3, 'sanity'),
  );
  assert.throws(
    () => assertSameValue(subject('a x = b'), subject('w a x = b'), s3, 'one side only'),
    /changed the truth of the equation/,
  );
});

/**
 * What soundness alone cannot see.
 *
 * `left-multiply` and `right-multiply` are *both* valid, so an implementation
 * that produced one when asked for the other would be perfectly sound and this
 * file would never notice. Only the shape of the result tells them apart, so
 * that is asserted structurally — and it matters, because in a non-abelian
 * group the two give genuinely different equations.
 */
test('left and right multiplication are distinguishable, and not by their soundness', () => {
  const start = subject('a x = b');
  const w = { term: parseTerm('w') };

  const left = applyToSubject(start, 'left-multiply', { kind: 'equation' }, w);
  const right = applyToSubject(start, 'right-multiply', { kind: 'equation' }, w);

  assert.equal(subjectSource(left.subject), 'w a x = w b');
  assert.equal(subjectSource(right.subject), 'a x w = b w');
  assert.notEqual(subjectSource(left.subject), subjectSource(right.subject));

  // Both are true, which is exactly why the evaluator cannot separate them.
  const s3 = symmetricGroup(3);
  assert.doesNotThrow(() => assertSameValue(start, left.subject, s3, 'left-multiply'));
  assert.doesNotThrow(() => assertSameValue(start, right.subject, s3, 'right-multiply'));

  // And they say which they were, so a record cannot conflate them.
  assert.match(left.detail, /on the left by w/);
  assert.match(right.detail, /on the right by w/);
});

/* Whole proofs ------------------------------------------------------------ */

test('a left-multiplication really does let x be solved for', () => {
  const s3 = symmetricGroup(3);
  let state = subject('a x = b');

  const steps: [string, string | null][] = [
    ['left-multiply', 'a^-1'],
    ['cancel-inverse', null],
    ['remove-identity', null],
  ];

  for (const [rule, multiplier] of steps) {
    const [address] = findAddresses(state, rule as never);
    const argument = multiplier === null ? undefined : { term: parseTerm(multiplier) };
    const next = applyToSubject(state, rule as never, address, argument);
    assertSameValue(state, next.subject, s3, rule);
    state = next.subject;
  }

  assert.equal(subjectSource(state), 'x = a^-1 b');
});

test('expression proofs are unaffected by any of this', () => {
  const start = expression(parseTerm('a a^-1 b'));
  const [address] = findAddresses(start, 'cancel-inverse');
  const result = applyToSubject(start, 'cancel-inverse', address);
  assertSameValue(start, result.subject, symmetricGroup(3), 'cancel-inverse');
});
