import assert from 'node:assert/strict';
import { test } from 'node:test';

import { exactGoal, goalProse, goalReached, goalSpeech, goalsEqual, isolatedGoal } from '../app/goal.ts';
import { parseSubject } from '../app/parse.ts';

const at = (source: string) => parseSubject(source);

/* ------------------------------------------------------------------ */
/* Exact goals                                                         */
/* ------------------------------------------------------------------ */

test('an exact goal is reached only by that exact line', () => {
  const goal = exactGoal(at('b'));
  assert.equal(goalReached(at('b'), goal), true);
  assert.equal(goalReached(at('b e'), goal), false);
});

/**
 * The Phase 3 decision, unchanged by goal shapes arriving: reaching `v = u`
 * when the goal is `u = v` leaves symmetry still to be spent.
 */
test('an exact goal stays orientation sensitive', () => {
  const goal = exactGoal(at('x = a^-1 b'));
  assert.equal(goalReached(at('x = a^-1 b'), goal), true);
  assert.equal(goalReached(at('a^-1 b = x'), goal), false);
});

/* ------------------------------------------------------------------ */
/* Goal shapes                                                         */
/* ------------------------------------------------------------------ */

test('solving for x accepts any arrangement of the other side', () => {
  const goal = isolatedGoal('x', 'left');
  assert.equal(goalReached(at('x = a^-1 b'), goal), true);
  assert.equal(goalReached(at('x = b c d'), goal), true);
  assert.equal(goalReached(at('x = e'), goal), true);
});

/**
 * The condition that makes it mean "solved" rather than "tidy". `x = x b` has
 * x by itself on the left and has not been solved for x at all.
 */
test('x is not solved for while it still appears on the other side', () => {
  const goal = isolatedGoal('x', 'left');
  assert.equal(goalReached(at('x = x b'), goal), false);
  assert.equal(goalReached(at('x = (a x^-1)^-1'), goal), false);
  assert.equal(goalReached(at('x = a x^2 b'), goal), false);
});

test('x must be alone, not merely present', () => {
  const goal = isolatedGoal('x', 'left');
  assert.equal(goalReached(at('a x = b'), goal), false);
  assert.equal(goalReached(at('x^-1 = b'), goal), false);
  assert.equal(goalReached(at('x e = b'), goal), false);
});

test('a goal shape names its side, and the other side is not it', () => {
  assert.equal(goalReached(at('x = a b'), isolatedGoal('x', 'right')), false);
  assert.equal(goalReached(at('a b = x'), isolatedGoal('x', 'right')), true);
});

test('an expression can never satisfy a goal shape about an equation', () => {
  assert.equal(goalReached(at('x'), isolatedGoal('x', 'left')), false);
});

test('a goal shape names a generator, and refuses anything else', () => {
  assert.throws(() => isolatedGoal('a b', 'left'), TypeError);
  assert.throws(() => isolatedGoal('', 'left'), TypeError);
});

/* ------------------------------------------------------------------ */
/* Saying and comparing                                                */
/* ------------------------------------------------------------------ */

test('goals compare by kind as well as content', () => {
  assert.equal(goalsEqual(exactGoal(at('b')), exactGoal(at('b'))), true);
  assert.equal(goalsEqual(exactGoal(at('b')), exactGoal(at('c'))), false);
  assert.equal(goalsEqual(isolatedGoal('x', 'left'), isolatedGoal('x', 'left')), true);
  assert.equal(goalsEqual(isolatedGoal('x', 'left'), isolatedGoal('x', 'right')), false);
  assert.equal(goalsEqual(isolatedGoal('x', 'left'), exactGoal(at('x = b'))), false);
  assert.equal(goalsEqual(null, null), true);
  assert.equal(goalsEqual(null, exactGoal(at('b'))), false);
});

test('a goal never speaks in TeX', () => {
  for (const goal of [exactGoal(at('(ab)^-1')), isolatedGoal('x', 'left')]) {
    assert.ok(!/[\\^{}]/.test(goalSpeech(goal)), goalSpeech(goal));
  }
});

test('a goal shape says what it wants in words, because it has no line to show', () => {
  const prose = goalProse(isolatedGoal('x', 'left'));
  assert.match(prose, /x by itself on the left/);
  assert.match(prose, /no x left on the other side/);
});
