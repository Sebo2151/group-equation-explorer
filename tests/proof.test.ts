import assert from 'node:assert/strict';
import test from 'node:test';
import { expressionTex, START, type Factor } from '../app/core.ts';
import {
  applyRule,
  canRedo,
  canUndo,
  createProof,
  currentLine,
  factorsEqual,
  isComplete,
  redo,
  restart,
  stepCount,
  undo,
  visibleLines,
  type ProofState,
} from '../app/proof.ts';

const at = (start: number, end = start) => ({ start, end });
const GOAL: Factor[] = [{ base: 'b' }];
const tex = (state: ProofState) => expressionTex(currentLine(state).factors);

/** The canonical four-step solution, cancelling the left pair first. */
function solve(state: ProofState): ProofState {
  return [
    ['inverse', at(0, 1)],
    ['identity', at(0)],
    ['inverse', at(1, 2)],
    ['identity', at(1)],
  ].reduce<ProofState>(
    (acc, [rule, target]) => applyRule(acc, rule as 'inverse' | 'identity', target as ReturnType<typeof at>),
    state,
  );
}

test('a new proof starts on the opening line with nothing to undo or redo', () => {
  const state = createProof(START);
  assert.equal(stepCount(state), 0);
  assert.equal(canUndo(state), false);
  assert.equal(canRedo(state), false);
  assert.equal(visibleLines(state).length, 1);
  assert.equal(currentLine(state).step, undefined);
  assert.equal(isComplete(state, GOAL), false);
});

test('creating a proof copies the starting factors', () => {
  const start: Factor[] = [{ base: 'a' }];
  const state = createProof(start);
  state.lines[0].factors[0].base = 'z';
  assert.equal(start[0].base, 'a');
});

test('applying a rule appends one line and advances the cursor', () => {
  const state = applyRule(createProof(START), 'inverse', at(0, 1));
  assert.equal(stepCount(state), 1);
  assert.equal(visibleLines(state).length, 2);
  assert.equal(tex(state), 'ebc^{-1}c');
});

test('a committed step records the rule and target, not only the label', () => {
  const step = currentLine(applyRule(createProof(START), 'inverse', at(3, 4))).step;
  assert.deepEqual(step, {
    rule: 'inverse',
    target: at(3, 4),
    reason: 'Inverse law',
    detail: 'c inverse times c is the identity',
  });
});

test('step reasons and details are plain words, never TeX source', () => {
  // These strings are both displayed and read aloud, so `c^{-1}` would be
  // announced as "c caret left brace minus one right brace".
  const solved = solve(createProof(START));
  for (const { step } of visibleLines(solved).slice(1)) {
    assert.doesNotMatch(step!.reason, /[\\^{}]/, step!.reason);
    assert.doesNotMatch(step!.detail, /[\\^{}]/, step!.detail);
  }
});

test('applying a rule does not mutate the previous state', () => {
  const before = createProof(START);
  const snapshot = JSON.stringify(before);
  applyRule(before, 'inverse', at(0, 1));
  assert.equal(JSON.stringify(before), snapshot);
});

test('an illegal move is refused and cannot damage the proof', () => {
  const state = createProof(START);
  assert.throws(() => applyRule(state, 'identity', at(0)), /not valid/);
  assert.equal(stepCount(state), 0);
  assert.equal(tex(state), 'aa^{-1}bc^{-1}c');
});

test('the example completes in four steps and is recognized as complete', () => {
  const state = solve(createProof(START));
  assert.equal(stepCount(state), 4);
  assert.equal(tex(state), 'b');
  assert.ok(isComplete(state, GOAL));
});

test('the right-hand pair may be cancelled first, also in four steps', () => {
  let state = createProof(START);
  state = applyRule(state, 'inverse', at(3, 4));
  assert.equal(tex(state), 'aa^{-1}be');
  state = applyRule(state, 'identity', at(3));
  assert.equal(tex(state), 'aa^{-1}b');
  state = applyRule(state, 'inverse', at(0, 1));
  assert.equal(tex(state), 'eb');
  state = applyRule(state, 'identity', at(0));

  assert.equal(stepCount(state), 4);
  assert.ok(isComplete(state, GOAL));
});

test('undo walks back one step at a time and re-exposes earlier lines', () => {
  const solved = solve(createProof(START));
  const once = undo(solved);

  assert.equal(stepCount(once), 3);
  assert.equal(tex(once), 'be');
  assert.equal(visibleLines(once).length, 4);
  assert.ok(canRedo(once));
  assert.equal(isComplete(once, GOAL), false);
});

test('undo past the opening line is a no-op', () => {
  const state = undo(undo(createProof(START)));
  assert.equal(stepCount(state), 0);
  assert.equal(canUndo(state), false);
});

test('redo past the newest line is a no-op', () => {
  const state = applyRule(createProof(START), 'inverse', at(0, 1));
  assert.equal(canRedo(state), false);
  assert.equal(stepCount(redo(state)), 1);
});

test('undo and redo restore the same proof, including completion', () => {
  const solved = solve(createProof(START));
  const roundTrip = redo(redo(undo(undo(solved))));

  assert.equal(stepCount(roundTrip), stepCount(solved));
  assert.deepEqual(roundTrip.lines, solved.lines);
  assert.ok(isComplete(roundTrip, GOAL));
});

test('a different move after undo discards the redo branch permanently', () => {
  const solved = solve(createProof(START));

  // Step back to `bc^{-1}c`, then take the identity-free route instead.
  const rewound = undo(undo(solved));
  assert.equal(tex(rewound), 'bc^{-1}c');
  assert.ok(canRedo(rewound));

  const branched = applyRule(rewound, 'inverse', at(1, 2));
  assert.equal(canRedo(branched), false, 'the abandoned future must not be reachable');
  assert.equal(visibleLines(branched).length, branched.lines.length);

  // Pressing Redo repeatedly must not resurrect the discarded lines.
  const pressed = redo(redo(redo(branched)));
  assert.equal(stepCount(pressed), stepCount(branched));
  assert.equal(tex(pressed), 'be');
});

test('branching from the opening line discards every later line', () => {
  const solved = solve(createProof(START));
  const rewound = undo(undo(undo(undo(solved))));
  assert.equal(stepCount(rewound), 0);

  const branched = applyRule(rewound, 'inverse', at(3, 4));
  assert.equal(branched.lines.length, 2);
  assert.equal(canRedo(branched), false);
  assert.equal(tex(branched), 'aa^{-1}be');
});

test('restart returns to the opening line and drops all history', () => {
  const state = restart(solve(createProof(START)));
  assert.equal(stepCount(state), 0);
  assert.equal(state.lines.length, 1);
  assert.equal(canUndo(state), false);
  assert.equal(canRedo(state), false);
  assert.equal(tex(state), 'aa^{-1}bc^{-1}c');
});

test('restart after undo still clears the redo branch', () => {
  const state = restart(undo(solve(createProof(START))));
  assert.equal(state.lines.length, 1);
  assert.equal(canRedo(state), false);
});

test('completion compares terms, not rendered TeX', () => {
  // The empty product and an explicit identity both render as `e`.
  const empty = createProof([]);
  const identity = createProof([{ base: 'e', identity: true }]);

  assert.equal(expressionTex(currentLine(empty).factors), 'e');
  assert.equal(expressionTex(currentLine(identity).factors), 'e');

  assert.ok(isComplete(empty, []));
  assert.equal(isComplete(empty, [{ base: 'e', identity: true }]), false);
  assert.ok(isComplete(identity, [{ base: 'e', identity: true }]));
  assert.equal(isComplete(identity, []), false);
});

test('factorsEqual distinguishes order, inverses and the identity', () => {
  assert.ok(factorsEqual([{ base: 'a' }, { base: 'b' }], [{ base: 'a' }, { base: 'b' }]));
  assert.equal(factorsEqual([{ base: 'a' }, { base: 'b' }], [{ base: 'b' }, { base: 'a' }]), false);
  assert.equal(factorsEqual([{ base: 'a' }], [{ base: 'a', inverse: true }]), false);
  assert.equal(factorsEqual([{ base: 'a' }], [{ base: 'a' }, { base: 'b' }]), false);
  assert.ok(factorsEqual([{ base: 'a', inverse: false }], [{ base: 'a' }]));
});

test('every visible line after the first carries the step that justified it', () => {
  const solved = solve(createProof(START));
  const [opening, ...derived] = visibleLines(solved);

  assert.equal(opening.step, undefined);
  assert.equal(derived.length, 4);
  for (const line of derived) {
    assert.ok(line.step, 'a derived line must record its justification');
    assert.ok(line.step && ['inverse', 'identity'].includes(line.step.rule));
  }
});

test('the recorded steps replay to the same expressions from the opening line', () => {
  // A stored label is not a certificate; the rule and target must reproduce the
  // line independently. This is the shape the Phase 2 replay check needs.
  const solved = solve(createProof(START));
  let replayed = createProof(currentLine(createProof(START)).factors);

  for (const line of visibleLines(solved).slice(1)) {
    replayed = applyRule(replayed, line.step!.rule, line.step!.target);
  }

  assert.deepEqual(
    visibleLines(replayed).map((line) => expressionTex(line.factors)),
    visibleLines(solved).map((line) => expressionTex(line.factors)),
  );
});
