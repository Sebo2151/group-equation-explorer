import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CHALLENGES,
  challengeById,
  challengeSetup,
  resolveMove,
  type Challenge,
} from '../app/challenges.ts';
import { applyRule, createProof, currentLine, isComplete, type ProofState } from '../app/proof.ts';
import {
  bestFor,
  completedCount,
  earnedRules,
  emptyProgress,
  isChallengeComplete,
  isUnlocked,
  nextChallenge,
  progressFromJson,
  progressToJson,
  readProgress,
  recordProof,
  requiredChallenge,
  standing,
  type Progress,
} from '../app/progress.ts';

/** Work a challenge to its end, the way its authored proof says. */
function solve(challenge: Challenge): ProofState {
  return challenge.solution.reduce((state, move) => {
    const resolved = resolveMove(currentLine(state).subject, move)!;
    return applyRule(state, move.rule, resolved.address, resolved.argument);
  }, createProof(challengeSetup(challenge)));
}

function withSolved(...ids: string[]): Progress {
  return ids.reduce(
    (progress, id) => recordProof(progress, solve(challengeById(id)!)),
    emptyProgress(),
  );
}

const FIRST = CHALLENGES[0];
const SECOND = CHALLENGES[1];

/* ------------------------------------------------------------------ */
/* Recording                                                           */
/* ------------------------------------------------------------------ */

test('an unfinished proof records nothing', () => {
  const started = createProof(challengeSetup(FIRST));
  const before = emptyProgress();
  const after = recordProof(before, started);
  assert.equal(after, before, 'an unfinished proof should leave progress untouched');
  assert.equal(completedCount(after), 0);
});

test('free exploration is not a challenge and is never recorded', () => {
  const solved = solve(FIRST);
  const asFree = { ...solved, challenge: 'free' };
  assert.equal(completedCount(recordProof(emptyProgress(), asFree)), 0);
});

test('a finished proof records its length and the tools it used', () => {
  const progress = withSolved(FIRST.id);
  const record = bestFor(progress, FIRST.id)!;
  assert.equal(record.steps, FIRST.solution.length);
  assert.deepEqual(record.ruleset, FIRST.rules);
  assert.equal(standing(progress, FIRST), 'matched');
});

/**
 * A personal best is a comparison, and a comparison needs both sides to have
 * been made under the same conditions. A longer proof under the same tools is
 * not an improvement and must not displace the record.
 */
test('a longer proof does not displace a shorter one under the same tools', () => {
  const short = withSolved(FIRST.id);

  // The same challenge, worked the long way round: cancel the second pair first.
  let long = createProof(challengeSetup(FIRST));
  const detour = [
    { rule: 'cancel-inverse' as const, at: 2 },
    { rule: 'cancel-inverse' as const, at: 1 },
    { rule: 'remove-identity' as const, at: 1 },
    { rule: 'remove-identity' as const, at: 1 },
  ];
  for (const move of detour) {
    const resolved = resolveMove(currentLine(long).subject, move)!;
    long = applyRule(long, move.rule, resolved.address, resolved.argument);
  }
  assert.ok(isComplete(long));

  const after = recordProof(short, long);
  assert.equal(bestFor(after, FIRST.id)!.steps, bestFor(short, FIRST.id)!.steps);
});

/* ------------------------------------------------------------------ */
/* Unlocking                                                           */
/* ------------------------------------------------------------------ */

test('the first challenge is always open and the rest wait their turn', () => {
  const nothing = emptyProgress();
  assert.equal(isUnlocked(nothing, FIRST.id), true);
  assert.equal(isUnlocked(nothing, SECOND.id), false);

  const after = withSolved(FIRST.id);
  assert.equal(isUnlocked(after, SECOND.id), true);
  assert.equal(isUnlocked(after, CHALLENGES[2].id), false);
});

test('continuing goes to the first challenge not yet proved', () => {
  assert.equal(nextChallenge(emptyProgress())?.id, FIRST.id);
  assert.equal(nextChallenge(withSolved(FIRST.id))?.id, SECOND.id);
});

test('a locked menu entry leads to the earliest unfinished prerequisite', () => {
  const last = CHALLENGES.at(-1)!;
  assert.equal(requiredChallenge(emptyProgress(), last.id)?.id, FIRST.id);
  assert.equal(requiredChallenge(withSolved(FIRST.id), last.id)?.id, SECOND.id);
  assert.equal(requiredChallenge(emptyProgress(), 'not-a-challenge'), undefined);
});

/**
 * The point of the arrangement: a law shows up only after the challenge that
 * proves it has been finished, and never before.
 */
test('a law is earned only by proving it', () => {
  const lemma = CHALLENGES.find((entry) => (entry.grants ?? []).length > 0)!;
  const granted = lemma.grants![0];

  const before = CHALLENGES.slice(0, CHALLENGES.indexOf(lemma)).map((entry) => entry.id);
  assert.equal(earnedRules(withSolved(...before)).includes(granted), false);
  assert.equal(earnedRules(withSolved(...before, lemma.id)).includes(granted), true);
});

/* ------------------------------------------------------------------ */
/* Reading untrusted storage                                           */
/* ------------------------------------------------------------------ */

test('nonsense in storage reads as no progress rather than throwing', () => {
  for (const value of [null, 42, 'progress', [], {}, { format: 'other', version: 1, best: {} }]) {
    assert.equal(completedCount(readProgress(value).progress), 0);
  }
});

test('a genuine record survives a round trip through storage', () => {
  const progress = withSolved(FIRST.id, SECOND.id);
  const read = progressFromJson(progressToJson(progress));
  assert.deepEqual(read.discarded, []);
  assert.equal(completedCount(read.progress), 2);
  assert.equal(bestFor(read.progress, FIRST.id)!.steps, FIRST.solution.length);
});

/**
 * The acceptance criterion this whole design exists for. Progress is stored as
 * proofs precisely so that claiming one is not the same as having one.
 */
test('a completion claimed without a proof is refused', () => {
  const forged = {
    ...emptyProgress(),
    best: { [FIRST.id]: { steps: 1, ruleset: FIRST.rules, record: null } },
  };
  const read = readProgress(forged);
  assert.equal(isChallengeComplete(read.progress, FIRST.id), false);
  assert.deepEqual(read.discarded, [FIRST.id]);
});

test('a real proof relabelled as a shorter one is refused, not trusted', () => {
  const honest = withSolved(FIRST.id);
  const tampered = JSON.parse(progressToJson(honest));
  tampered.best[FIRST.id].steps = 1;

  const read = readProgress(tampered);
  assert.equal(isChallengeComplete(read.progress, FIRST.id), false);
  assert.deepEqual(read.discarded, [FIRST.id]);
});

/**
 * The other way somebody might try it: prove the challenge with tools it does
 * not permit, then file the result against it. `importProofRecord` refuses the
 * record, so the entry never becomes evidence.
 */
test('a proof built with forbidden tools cannot be filed against a challenge', () => {
  const honest = withSolved(FIRST.id);
  const tampered = JSON.parse(progressToJson(honest));
  tampered.best[FIRST.id].record.ruleset = [...FIRST.rules, 'inverse-of-product'];

  assert.deepEqual(readProgress(tampered).discarded, [FIRST.id]);
});

test('a proof filed under the wrong challenge is refused', () => {
  const honest = withSolved(FIRST.id);
  const tampered = JSON.parse(progressToJson(honest));
  tampered.best[SECOND.id] = tampered.best[FIRST.id];
  delete tampered.best[FIRST.id];

  const read = readProgress(tampered);
  assert.equal(completedCount(read.progress), 0);
  assert.deepEqual(read.discarded, [SECOND.id]);
});

test('one bad entry does not cost the others', () => {
  const honest = withSolved(FIRST.id, SECOND.id);
  const tampered = JSON.parse(progressToJson(honest));
  tampered.best[SECOND.id].steps = 99;

  const read = readProgress(tampered);
  assert.equal(isChallengeComplete(read.progress, FIRST.id), true);
  assert.equal(isChallengeComplete(read.progress, SECOND.id), false);
  assert.deepEqual(read.discarded, [SECOND.id]);
});

test('an entry naming a challenge that no longer exists is dropped', () => {
  const stored = { ...emptyProgress(), best: { 'a-removed-challenge': { steps: 1 } } };
  assert.deepEqual(readProgress(stored).discarded, ['a-removed-challenge']);
});

/* ------------------------------------------------------------------ */
/* The whole curriculum                                                */
/* ------------------------------------------------------------------ */

/**
 * Walk the course as a learner would, in order, and check the two things that
 * have to hold all the way along: nothing is reachable before its turn, and
 * every law a challenge offers has already been proved by the time it is
 * offered. This is the running version of the static dependency test.
 */
test('working the curriculum in order unlocks it exactly one at a time', () => {
  let progress = emptyProgress();

  for (const challenge of CHALLENGES) {
    assert.ok(isUnlocked(progress, challenge.id), `${challenge.id} was not open in turn`);

    const earned = new Set(earnedRules(progress));
    for (const rule of challenge.rules) {
      const from = CHALLENGES.find((entry) => entry.grants?.includes(rule));
      if (from) {
        assert.ok(earned.has(rule), `${challenge.id} offers ${rule} before it was proved`);
      }
    }

    const finished = solve(challenge);
    assert.ok(isComplete(finished), `${challenge.id} did not finish`);
    progress = recordProof(progress, finished);
  }

  assert.equal(completedCount(progress), CHALLENGES.length);
  // And all of it still checks out when read back from storage.
  assert.deepEqual(progressFromJson(progressToJson(progress)).discarded, []);
});
