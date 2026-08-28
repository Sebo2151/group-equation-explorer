import assert from 'node:assert/strict';
import { test } from 'node:test';

import { challengeSetup, challengeById } from '../app/challenges.ts';
import { parseTerm } from '../app/parse.ts';
import { applyRule, createProof, isComplete, visibleLines, type ProofState } from '../app/proof.ts';
import {
  exportProof,
  importProof,
  MAX_HASH_CHARACTERS,
  MAX_IMPORT_CHARACTERS,
  PROOF_FORMAT,
  proofFromHash,
  proofToHash,
  proofToJson,
  proofToLatex,
} from '../app/serialize.ts';
import { termSource } from '../app/term.ts';

function solvedOpening(): ProofState {
  let proof = createProof(challengeSetup(challengeById('cancel-pairs')!));
  proof = applyRule(proof, 'cancel-inverse', { path: [], start: 0, end: 1 });
  proof = applyRule(proof, 'cancel-inverse', { path: [], start: 2, end: 3 });
  proof = applyRule(proof, 'remove-identity', { path: [], start: 0, end: 0 });
  proof = applyRule(proof, 'remove-identity', { path: [], start: 1, end: 1 });
  return proof;
}

function withInsertion(): ProofState {
  return applyRule(
    createProof(challengeSetup(challengeById('insert-a-pair')!)),
    'insert-inverse-pair',
    { path: [], start: 0, end: -1 },
    { term: parseTerm('a'), inverseFirst: true },
  );
}

function chain(state: ProofState): string[] {
  return visibleLines(state).map((line) => termSource(line.term));
}

/* Round trip ------------------------------------------------------------- */

test('a finished proof exports and re-imports to the same chain', () => {
  const proof = solvedOpening();
  const restored = importProof(proofToJson(proof));

  assert.deepEqual(chain(restored), chain(proof));
  assert.deepEqual(restored.ruleset, proof.ruleset);
  assert.equal(restored.challenge, proof.challenge);
  assert.ok(isComplete(restored));
});

test('an instantiated term survives the round trip', () => {
  const proof = withInsertion();
  const record = exportProof(proof);
  assert.equal(record.steps[0].term, 'a');
  assert.equal(record.steps[0].inverseFirst, true);

  const restored = importProof(proofToJson(proof));
  assert.deepEqual(chain(restored), ['b', 'a^-1 a b']);
  assert.ok(isComplete(restored));
});

test('nested structure survives the round trip', () => {
  const proof = applyRule(
    createProof(challengeSetup(challengeById('nested-inverse')!)),
    'inverse-of-product',
    { path: [], start: 0, end: 0 },
  );
  const restored = importProof(proofToJson(proof));
  assert.deepEqual(chain(restored), ['(a b^-1)^-1', '(b^-1)^-1 a^-1']);
});

test('the exported record carries the ruleset it was built with', () => {
  const record = exportProof(solvedOpening());
  assert.equal(record.format, PROOF_FORMAT);
  assert.deepEqual(record.ruleset, ['cancel-inverse', 'remove-identity']);
  assert.equal(record.start, 'a a^-1 b c^-1 c');
  assert.equal(record.goal, 'b');
  assert.equal(record.steps.length, 4);
});

/* Import is not trust ---------------------------------------------------- */

test('import rejects anything that is not a proof record', () => {
  const cases: [unknown, RegExp][] = [
    [42, /Paste the exported/],
    ['', /Nothing to import/],
    ['not json', /not valid JSON/],
    ['[]', /must be a JSON object/],
    ['{}', /not a Group Equation Explorer proof/],
    [JSON.stringify({ format: PROOF_FORMAT, version: 99 }), /Unsupported proof version/],
  ];
  for (const [value, message] of cases) {
    assert.throws(() => importProof(value), message, `expected ${String(value)} to be rejected`);
  }
});

test('import is size limited before any parsing work', () => {
  assert.throws(() => importProof('x'.repeat(MAX_IMPORT_CHARACTERS + 1)), /longer than/);
});

test('a tampered step is caught by replay, not by its label', () => {
  const record = exportProof(solvedOpening());
  // The label still says "Inverse law"; the target no longer cancels anything.
  record.steps[1] = { ...record.steps[1], start: 0, end: 1 };
  assert.throws(() => importProof(JSON.stringify(record)), /Step 2 .* does not check out/);
});

test('a step naming a rule outside the recorded ruleset is refused', () => {
  const record = exportProof(solvedOpening());
  record.steps[0] = { rule: 'inverse-of-product', path: [], start: 0, end: 0 };
  assert.throws(() => importProof(JSON.stringify(record)), /Step 1/);
});

test('a record cannot claim a challenge while using tools it forbids', () => {
  const record = exportProof(solvedOpening());
  record.ruleset = [...record.ruleset, 'inverse-of-product'];
  assert.throws(() => importProof(JSON.stringify(record)), /does not permit/);
});

test('a record cannot claim a challenge it does not actually start or finish', () => {
  const wrongStart = exportProof(solvedOpening());
  wrongStart.start = 'b';
  assert.throws(() => importProof(JSON.stringify(wrongStart)), /starts somewhere else/);

  const wrongGoal = exportProof(solvedOpening());
  wrongGoal.goal = 'a';
  assert.throws(() => importProof(JSON.stringify(wrongGoal)), /aims somewhere else/);

  const noGoal = exportProof(solvedOpening());
  noGoal.goal = null;
  assert.throws(() => importProof(JSON.stringify(noGoal)), /aims somewhere else/);
});

test('a record for an unknown challenge imports as free exploration', () => {
  const record = exportProof(solvedOpening());
  record.challenge = 'someone-elses-challenge';
  const restored = importProof(JSON.stringify(record));
  assert.equal(restored.challenge, 'someone-elses-challenge');
  assert.deepEqual(chain(restored), chain(solvedOpening()));
});

test('malformed steps are rejected with the step number', () => {
  const base = exportProof(solvedOpening());
  const cases: [unknown, RegExp][] = [
    [{ ...base, steps: [null] }, /Step 1 is malformed/],
    [{ ...base, steps: [{ rule: 'nope', path: [], start: 0, end: 1 }] }, /Step 1 names an unknown rule/],
    [{ ...base, steps: [{ rule: 'cancel-inverse', path: 'x', start: 0, end: 1 }] }, /target path/],
    [{ ...base, steps: [{ rule: 'cancel-inverse', path: [-1], start: 0, end: 1 }] }, /target path/],
    [{ ...base, steps: [{ rule: 'cancel-inverse', path: [], start: '0', end: 1 }] }, /target span/],
    [{ ...base, steps: [{ rule: 'cancel-inverse', path: [], start: 0, end: 1, term: 7 }] }, /unreadable term/],
    [{ ...base, steps: 'lots' }, /missing its steps/],
    [{ ...base, ruleset: ['made-up'] }, /does not have/],
    [{ ...base, start: 'a + b' }, /Unexpected character/],
  ];
  for (const [value, message] of cases) {
    assert.throws(() => importProof(JSON.stringify(value)), message, JSON.stringify(value).slice(0, 80));
  }
});

test('an instantiated term in an imported step is parsed, not trusted', () => {
  const record = exportProof(withInsertion());
  record.steps[0] = { ...record.steps[0], term: '\\rule{9999em}{9999em}' };
  assert.throws(() => importProof(JSON.stringify(record)), /Unexpected character/);
});

/* Links ------------------------------------------------------------------ */

test('a short proof round trips through a URL fragment', () => {
  const proof = solvedOpening();
  const hash = proofToHash(proof);
  assert.ok(hash && hash.startsWith('#proof='));
  const restored = proofFromHash(hash!);
  assert.deepEqual(chain(restored!), chain(proof));
});

test('a fragment without a proof is not an error', () => {
  assert.equal(proofFromHash(''), null);
  assert.equal(proofFromHash('#challenge=powers'), null);
});

test('an unreadable fragment is refused rather than half-read', () => {
  assert.throws(() => proofFromHash(`#proof=${'A'.repeat(MAX_HASH_CHARACTERS + 1)}`), /more than/);
  assert.throws(() => proofFromHash('#proof=notbase64!!'), /not readable|Unexpected/);
});

test('a proof too long to share says so instead of truncating', () => {
  let proof = createProof({
    challenge: 'free',
    start: parseTerm('a'),
    goal: null,
    ruleset: ['insert-identity'],
  });
  for (let index = 0; index < 120; index += 1) {
    proof = applyRule(proof, 'insert-identity', { path: [], start: 0, end: -1 });
  }
  assert.equal(proofToHash(proof), null);
});

/* LaTeX ------------------------------------------------------------------ */

test('LaTeX export is an aligned chain with one reason per line', () => {
  const latex = proofToLatex(solvedOpening());
  const lines = latex.trim().split('\n');

  assert.equal(lines[0], '\\begin{align*}');
  assert.equal(lines.at(-1), '\\end{align*}');
  assert.equal(lines[1].trim(), '& aa^{-1}bc^{-1}c \\\\');
  assert.equal(lines.filter((line) => line.includes('&=')).length, 4);
  assert.match(lines[2], /\\text\{Inverse law/);
});

test('LaTeX reason text is restricted to a safe set', () => {
  const latex = proofToLatex(solvedOpening());
  for (const match of latex.matchAll(/\\text\{([^}]*)\}/g)) {
    assert.doesNotMatch(match[1], /[\\{}$&#^_~%]/, `unsafe text reached LaTeX: ${match[1]}`);
  }
});
