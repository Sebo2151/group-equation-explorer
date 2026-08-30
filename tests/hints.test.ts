import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CHALLENGES,
  challengeById,
  challengeSetup,
  freeSetup,
  resolveMove,
  type Challenge,
} from '../app/challenges.ts';
import { MAX_HINT_LEVEL, hintFor, referenceLines, rejoinDepth } from '../app/hints.ts';
import { parseTerm } from '../app/parse.ts';
import { applyRule, createProof, currentLine, isComplete, type ProofState } from '../app/proof.ts';
import { expression } from '../app/subject.ts';

const FIRST = challengeById('cancel-pairs')!;

function step(state: ProofState, move: Parameters<typeof resolveMove>[1]): ProofState {
  const resolved = resolveMove(currentLine(state).subject, move)!;
  return applyRule(state, move.rule, resolved.address, resolved.argument);
}

function solve(challenge: Challenge): ProofState {
  return challenge.solution.reduce(step, createProof(challengeSetup(challenge)));
}

/* ------------------------------------------------------------------ */
/* The reference route                                                 */
/* ------------------------------------------------------------------ */

test('every challenge has a reference route that reaches its goal', () => {
  for (const challenge of CHALLENGES) {
    const route = referenceLines(challenge);
    assert.ok(route, `${challenge.id} has no usable reference route`);
    assert.ok(isComplete(route!), `${challenge.id}'s reference route does not finish`);
  }
});

/* ------------------------------------------------------------------ */
/* Grades                                                              */
/* ------------------------------------------------------------------ */

/**
 * The grades have to actually differ, and only the last one may hand over the
 * move. A "graduated" hint whose first grade already does the step is not
 * graduated at all.
 */
test('hints give away more at each grade, and only the last one acts', () => {
  const start = createProof(challengeSetup(FIRST));

  const first = hintFor(start, 1);
  const second = hintFor(start, 2);
  const third = hintFor(start, MAX_HINT_LEVEL);

  assert.equal(first.kind, 'step');
  assert.equal(second.kind, 'step');
  assert.equal(third.kind, 'step');

  assert.notEqual(first.text, second.text);
  assert.notEqual(second.text, third.text);

  assert.equal(first.kind === 'step' && first.offer, undefined);
  assert.equal(second.kind === 'step' && second.offer, undefined);
  assert.ok(third.kind === 'step' && third.offer, 'the last grade must offer the move');

  assert.equal(first.kind === 'step' && first.more, true);
  assert.equal(third.kind === 'step' && third.more, false);
});

test('the first grade names a palette category without naming the law', () => {
  const hint = hintFor(createProof(challengeSetup(FIRST)), 1);
  assert.equal(hint.kind, 'step');
  assert.match(hint.text, /Simplification/);
  assert.ok(!hint.text.includes('Cancel inverse pair'), hint.text);
});

test('a hint never speaks in TeX', () => {
  for (const challenge of CHALLENGES) {
    for (let level = 1; level <= MAX_HINT_LEVEL; level += 1) {
      const hint = hintFor(createProof(challengeSetup(challenge)), level);
      assert.ok(!/[\\{}]/.test(hint.text), `${challenge.id} level ${level}: ${hint.text}`);
    }
  }
});

/**
 * Whatever a hint offers has to be a move the app will actually accept — the
 * same path a clicked bracket takes. A hint that throws when taken would be
 * worse than no hint.
 */
test('the move a hint offers is one the proof accepts', () => {
  for (const challenge of CHALLENGES) {
    const hint = hintFor(createProof(challengeSetup(challenge)), MAX_HINT_LEVEL);
    assert.equal(hint.kind, 'step', challenge.id);
    const offer = hint.kind === 'step' ? hint.offer : undefined;
    assert.ok(offer, `${challenge.id} offered nothing at the last grade`);
    assert.doesNotThrow(
      () => applyRule(createProof(challengeSetup(challenge)), offer!.rule, offer!.address, offer!.argument),
      `${challenge.id}: the offered move was refused`,
    );
  }
});

/**
 * Following the hints all the way through has to finish the challenge. This is
 * what makes "nobody is stuck" a fact rather than an intention.
 */
test('taking every offered hint finishes every challenge', () => {
  for (const challenge of CHALLENGES) {
    let state = createProof(challengeSetup(challenge));
    for (let guard = 0; guard < 20 && !isComplete(state); guard += 1) {
      const hint = hintFor(state, MAX_HINT_LEVEL);
      assert.equal(hint.kind, 'step', `${challenge.id} stopped hinting before the end`);
      const offer = hint.kind === 'step' ? hint.offer! : null;
      state = applyRule(state, offer!.rule, offer!.address, offer!.argument);
    }
    assert.ok(isComplete(state), `${challenge.id} was not finished by its own hints`);
  }
});

/* ------------------------------------------------------------------ */
/* Going a different way                                               */
/* ------------------------------------------------------------------ */

/**
 * The case the design turns on. A learner who took the other cancellation
 * first has a perfectly correct line that is not on the authored route, and
 * must be told that rather than misdirected or blamed.
 */
test('a correct line off the route is reported as different, not as wrong', () => {
  const detour = step(createProof(challengeSetup(FIRST)), { rule: 'cancel-inverse', at: 2 });
  const hint = hintFor(detour, 1);

  assert.equal(hint.kind, 'diverged');
  assert.match(hint.text, /different way/);
  assert.match(hint.text, /Nothing is wrong with your line/);
  assert.equal(hint.kind === 'diverged' && hint.canRejoin, true);
});

test('stepping back onto the route is offered by exactly how far it is', () => {
  const detour = step(createProof(challengeSetup(FIRST)), { rule: 'cancel-inverse', at: 2 });
  assert.equal(rejoinDepth(detour), 1);

  const further = step(detour, { rule: 'remove-identity', at: 1 });
  assert.equal(rejoinDepth(further), 2);
});

test('a line reached by another road is still on the route if it is the same line', () => {
  // Both orders of cancelling reach `b` in the end; the opening line is
  // trivially on the route, and so is anything the route also passes through.
  const start = createProof(challengeSetup(FIRST));
  assert.equal(rejoinDepth(start), 0);
  assert.equal(hintFor(start, 1).kind, 'step');
});

/* ------------------------------------------------------------------ */
/* Where there is nothing to hint at                                   */
/* ------------------------------------------------------------------ */

test('free exploration has no route, and says so plainly', () => {
  const free = createProof(freeSetup(expression(parseTerm('a a^-1'))));
  const hint = hintFor(free, 1);
  assert.equal(hint.kind, 'none');
  assert.match(hint.text, /your own exploration/);
});

test('a finished challenge has nothing left to hint at', () => {
  const hint = hintFor(solve(FIRST), 1);
  assert.equal(hint.kind, 'none');
  assert.match(hint.text, /finished/);
});
