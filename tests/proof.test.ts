import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseTerm } from '../app/parse.ts';
import {
  applyRule,
  canRedo,
  canUndo,
  createProof,
  currentLine,
  isComplete,
  MAX_STEPS,
  redo,
  replayableSteps,
  replayProof,
  restart,
  ruleAllowed,
  stepCount,
  undo,
  verifyProof,
  visibleLines,
  type ProofSetup,
  type ProofState,
} from '../app/proof.ts';
import type { AnyRuleId } from '../app/catalogue.ts';
import { exactGoal } from '../app/goal.ts';
import { expression, subjectSource, type Address } from '../app/subject.ts';
import { type Target } from '../app/term.ts';

const OPENING: ProofSetup = {
  challenge: 'cancel-pairs',
  start: expression(parseTerm('a a^-1 b c^-1 c')),
  goal: exactGoal(expression(parseTerm('b'))),
  ruleset: ['cancel-inverse', 'remove-identity'],
};

function source(state: ProofState): string {
  return subjectSource(currentLine(state).subject);
}

function chain(state: ProofState): string[] {
  return visibleLines(state).map((line) => subjectSource(line.subject));
}

const left: Target = { path: [], start: 0, end: 1 };

/** Every line in this file is an expression, so every address is one too. */
const at = (target: Target): Address => ({ kind: 'expression', target });

/* Setup ------------------------------------------------------------------ */

test('a new proof has one line and nothing to undo', () => {
  const proof = createProof(OPENING);
  assert.equal(stepCount(proof), 0);
  assert.equal(canUndo(proof), false);
  assert.equal(canRedo(proof), false);
  assert.equal(isComplete(proof), false);
  assert.deepEqual(chain(proof), ['a a^-1 b c^-1 c']);
});

test('the ruleset is recorded, de-duplicated, and validated', () => {
  const proof = createProof({ ...OPENING, ruleset: ['cancel-inverse', 'cancel-inverse'] });
  assert.deepEqual(proof.ruleset, ['cancel-inverse']);
  assert.throws(() => createProof({ ...OPENING, ruleset: [] }), /at least one/);
  assert.throws(() => createProof({ ...OPENING, ruleset: ['nope' as AnyRuleId] }), /Unknown rule id/);
  assert.throws(() => createProof({ ...OPENING, ruleset: 'all' as never }), /list of rule ids/);
});

test('a rule outside the challenge ruleset is refused even where it would apply', () => {
  const proof = createProof({ ...OPENING, ruleset: ['remove-identity'] });
  assert.equal(ruleAllowed(proof, 'cancel-inverse'), false);
  assert.throws(() => applyRule(proof, 'cancel-inverse', at(left)), /not available in this challenge/);
});

/* Building a chain ------------------------------------------------------- */

test('the opening challenge completes in four steps, either order first', () => {
  const rightPair: Target = { path: [], start: 3, end: 4 };

  let proof = createProof(OPENING);
  proof = applyRule(proof, 'cancel-inverse', at(left));
  assert.equal(source(proof), 'e b c^-1 c');
  // The second pair has shifted left by one: targets are indices into the
  // current line, never into the line the learner first saw.
  proof = applyRule(proof, 'cancel-inverse', at({ path: [], start: 2, end: 3 }));
  assert.equal(source(proof), 'e b e');
  proof = applyRule(proof, 'remove-identity', at({ path: [], start: 0, end: 0 }));
  proof = applyRule(proof, 'remove-identity', at({ path: [], start: 1, end: 1 }));
  assert.equal(source(proof), 'b');
  assert.ok(isComplete(proof));
  assert.equal(stepCount(proof), 4);

  let other = createProof(OPENING);
  other = applyRule(other, 'cancel-inverse', at(rightPair));
  assert.equal(source(other), 'a a^-1 b e');
  other = applyRule(other, 'cancel-inverse', at(left));
  other = applyRule(other, 'remove-identity', at({ path: [], start: 0, end: 0 }));
  other = applyRule(other, 'remove-identity', at({ path: [], start: 1, end: 1 }));
  assert.ok(isComplete(other));
  assert.equal(stepCount(other), 4);
});

test('every intermediate line is recorded with its rule, target and reason', () => {
  const proof = applyRule(createProof(OPENING), 'cancel-inverse', at(left));
  const [, second] = visibleLines(proof);
  assert.deepEqual(second.step?.rule, 'cancel-inverse');
  assert.deepEqual(second.step?.address, at(left));
  assert.equal(second.step?.reason, 'Inverse law');
  assert.match(second.step?.detail ?? '', /identity/);
  assert.deepEqual(chain(proof), ['a a^-1 b c^-1 c', 'e b c^-1 c']);
});

test('an instantiated term is recorded on the step', () => {
  const proof = applyRule(
    createProof({
      challenge: 'free',
      start: expression(parseTerm('b')),
      goal: null,
      ruleset: ['insert-inverse-pair'],
    }),
    'insert-inverse-pair',
    at({ path: [], start: 0, end: -1 }),
    { term: parseTerm('a'), inverseFirst: true },
  );
  assert.equal(source(proof), 'a^-1 a b');
  assert.equal(subjectSource(expression(currentLine(proof).step!.argument!.term)), 'a');
  assert.equal(currentLine(proof).step!.argument!.inverseFirst, true);
});

test('applying a rule does not mutate the previous state', () => {
  const proof = createProof(OPENING);
  const snapshot = JSON.parse(JSON.stringify(proof));
  applyRule(proof, 'cancel-inverse', at(left));
  assert.deepEqual(JSON.parse(JSON.stringify(proof)), snapshot);
});

/* Undo, redo, restart ---------------------------------------------------- */

test('undo and redo move the cursor without losing lines', () => {
  let proof = applyRule(createProof(OPENING), 'cancel-inverse', at(left));
  proof = applyRule(proof, 'remove-identity', at({ path: [], start: 0, end: 0 }));
  assert.equal(source(proof), 'b c^-1 c');

  proof = undo(proof);
  assert.equal(source(proof), 'e b c^-1 c');
  assert.ok(canRedo(proof));
  assert.deepEqual(chain(proof), ['a a^-1 b c^-1 c', 'e b c^-1 c']);

  proof = redo(proof);
  assert.equal(source(proof), 'b c^-1 c');
  assert.equal(canRedo(proof), false);
});

test('undo at the opening and redo at the tip do nothing', () => {
  const proof = createProof(OPENING);
  assert.equal(undo(proof), proof);
  assert.equal(redo(proof), proof);
});

test('a different move after undo discards the abandoned future', () => {
  let proof = applyRule(createProof(OPENING), 'cancel-inverse', at(left));
  proof = undo(proof);
  proof = applyRule(proof, 'cancel-inverse', at({ path: [], start: 3, end: 4 }));

  assert.equal(source(proof), 'a a^-1 b e');
  assert.equal(canRedo(proof), false);
  proof = redo(proof);
  assert.equal(source(proof), 'a a^-1 b e', 'the discarded branch came back');
});

test('undo works across completion', () => {
  let proof = createProof(OPENING);
  proof = applyRule(proof, 'cancel-inverse', at(left));
  proof = applyRule(proof, 'cancel-inverse', at({ path: [], start: 2, end: 3 }));
  proof = applyRule(proof, 'remove-identity', at({ path: [], start: 0, end: 0 }));
  proof = applyRule(proof, 'remove-identity', at({ path: [], start: 1, end: 1 }));
  assert.ok(isComplete(proof));

  proof = undo(proof);
  assert.equal(isComplete(proof), false);
  assert.equal(source(proof), 'b e');
  assert.ok(isComplete(redo(proof)));
});

test('restart returns to the opening line and keeps the ruleset', () => {
  let proof = applyRule(createProof(OPENING), 'cancel-inverse', at(left));
  proof = restart(proof);
  assert.equal(stepCount(proof), 0);
  assert.equal(canUndo(proof), false);
  assert.equal(canRedo(proof), false);
  assert.deepEqual(chain(proof), ['a a^-1 b c^-1 c']);
  assert.deepEqual(proof.ruleset, OPENING.ruleset);
  assert.equal(proof.challenge, 'cancel-pairs');
});

/* Completion ------------------------------------------------------------- */

test('completion compares terms, not rendered notation', () => {
  const toIdentity = createProof({
    challenge: 'free',
    start: expression(parseTerm('a a^-1')),
    goal: exactGoal(expression(parseTerm('e'))),
    ruleset: ['cancel-inverse'],
  });
  assert.equal(isComplete(toIdentity), false);
  assert.ok(isComplete(applyRule(toIdentity, 'cancel-inverse', at(left))));
});

test('a proof with no goal is never complete', () => {
  const free = createProof({
    challenge: 'free',
    start: expression(parseTerm('a a^-1')),
    goal: null,
    ruleset: ['cancel-inverse'],
  });
  assert.equal(isComplete(free), false);
  assert.equal(isComplete(applyRule(free, 'cancel-inverse', at(left))), false);
});

/* Replay ----------------------------------------------------------------- */

test('a finished proof replays from its recorded steps alone', () => {
  let proof = createProof(OPENING);
  proof = applyRule(proof, 'cancel-inverse', at(left));
  proof = applyRule(proof, 'cancel-inverse', at({ path: [], start: 2, end: 3 }));
  proof = applyRule(proof, 'remove-identity', at({ path: [], start: 0, end: 0 }));
  proof = applyRule(proof, 'remove-identity', at({ path: [], start: 1, end: 1 }));

  const replayed = verifyProof(proof);
  assert.deepEqual(chain(replayed), chain(proof));
  assert.ok(isComplete(replayed));
});

test('replay checks each step and names the one that fails', () => {
  assert.throws(
    () =>
      replayProof(OPENING, [
        { rule: 'cancel-inverse', address: at(left) },
        { rule: 'cancel-inverse', address: at({ path: [], start: 0, end: 1 }) },
      ]),
    /Step 2 \(cancel-inverse\) does not check out/,
  );
});

test('replay refuses a step using a rule outside the recorded ruleset', () => {
  assert.throws(
    () =>
      replayProof({ ...OPENING, ruleset: ['remove-identity'] }, [
        { rule: 'cancel-inverse', address: at(left) },
      ]),
    /Step 1 .* not available/,
  );
});

test('replay refuses an unknown rule id and a malformed step list', () => {
  assert.throws(
    () => replayProof(OPENING, [{ rule: 'teleport' as AnyRuleId, address: at(left) }]),
    /unknown rule id/,
  );
  assert.throws(() => replayProof(OPENING, 'steps' as never), /must be a list/);
});

test('replayable steps carry only what a verifier needs', () => {
  const proof = applyRule(createProof(OPENING), 'cancel-inverse', at(left));
  assert.deepEqual(replayableSteps(proof), [{ rule: 'cancel-inverse', address: at(left) }]);
});

test('the step limit is enforced', () => {
  assert.throws(
    () => replayProof(OPENING, Array.from({ length: MAX_STEPS + 1 }, () => ({ rule: 'cancel-inverse' as AnyRuleId, address: at(left) }))),
    /may not exceed/,
  );
});
