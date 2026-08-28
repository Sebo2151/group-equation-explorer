import assert from 'node:assert/strict';
import { test } from 'node:test';

import { challengeSetup, challengeById, freeSetup } from '../app/challenges.ts';
import { MAX_INPUT_LENGTH, parseTerm } from '../app/parse.ts';
import { applyRule, createProof, isComplete, MAX_STEPS, visibleLines, type ProofState } from '../app/proof.ts';
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
import { expression, subjectSource, type Address } from '../app/subject.ts';
import { MAX_NODES, type Target } from '../app/term.ts';

/** Every proof in this file is an expression chain, so every address is one. */
const at = (target: Target): Address => ({ kind: 'expression', target });

function solvedOpening(): ProofState {
  let proof = createProof(challengeSetup(challengeById('cancel-pairs')!));
  proof = applyRule(proof, 'cancel-inverse', at({ path: [], start: 0, end: 1 }));
  proof = applyRule(proof, 'cancel-inverse', at({ path: [], start: 2, end: 3 }));
  proof = applyRule(proof, 'remove-identity', at({ path: [], start: 0, end: 0 }));
  proof = applyRule(proof, 'remove-identity', at({ path: [], start: 1, end: 1 }));
  return proof;
}

function withInsertion(): ProofState {
  return applyRule(
    createProof(challengeSetup(challengeById('insert-a-pair')!)),
    'insert-inverse-pair',
    at({ path: [], start: 0, end: -1 }),
    { term: parseTerm('a'), inverseFirst: true },
  );
}

function chain(state: ProofState): string[] {
  return visibleLines(state).map((line) => subjectSource(line.subject));
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
    at({ path: [], start: 0, end: 0 }),
  );
  const restored = importProof(proofToJson(proof));
  assert.deepEqual(chain(restored), ['(a b^-1)^-1', '(b^-1)^-1 a^-1']);
});

test('canonical source longer than editor input survives records and links', () => {
  const start = parseTerm('a'.repeat(121));
  const opening = createProof(freeSetup(expression(start)));
  assert.ok(subjectSource(expression(start)).length > MAX_INPUT_LENGTH);
  assert.deepEqual(chain(proofFromHash(proofToHash(opening)!)!), chain(opening));

  const proof = applyRule(
    createProof(freeSetup(expression(start), expression(parseTerm('b'.repeat(121))))),
    'insert-inverse-pair',
    at({ path: [], start: 0, end: -1 }),
    { term: parseTerm('c'.repeat(121)) },
  );
  assert.deepEqual(importProof(proofToJson(proof)), proof);
});

test('a maximum-length nested proof uses compact JSON when formatting exceeds the limit', () => {
  let proof = createProof(freeSetup(expression(parseTerm('a^-1'))));
  for (let index = 0; index < MAX_STEPS; index += 1) {
    proof = applyRule(
      proof,
      index % 2 ? 'remove-identity' : 'insert-identity',
      at({ path: [0], start: 0, end: index % 2 ? 0 : -1 }),
    );
  }
  assert.ok(JSON.stringify(exportProof(proof), null, 2).length > MAX_IMPORT_CHARACTERS);
  const exported = proofToJson(proof);
  assert.ok(exported.length <= MAX_IMPORT_CHARACTERS);
  assert.deepEqual(importProof(exported), proof);
});

test('a record too large even without formatting is refused at export', () => {
  let proof = createProof(freeSetup(expression(parseTerm('a'))));
  const argument = { term: parseTerm(`r${'2'.repeat(MAX_INPUT_LENGTH - 1)}`) };
  for (let index = 0; index < Math.floor(MAX_STEPS / 3); index += 1) {
    proof = applyRule(proof, 'insert-inverse-pair', at({ path: [], start: 0, end: -1 }), argument);
    proof = applyRule(proof, 'cancel-inverse', at({ path: [], start: 0, end: 1 }));
    proof = applyRule(proof, 'remove-identity', at({ path: [], start: 0, end: 0 }));
  }
  assert.throws(() => proofToJson(proof), /too long to export/);
  assert.equal(proofToHash(proof), null);
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

test('the larger record text budget does not bypass structural limits', () => {
  const record = exportProof(createProof(freeSetup(expression(parseTerm('a')))));
  record.start = 'a '.repeat(MAX_NODES);
  assert.throws(() => importProof(JSON.stringify(record)), /more than .* parts/);
  record.start = '('.repeat(40) + 'a' + ')'.repeat(40);
  assert.throws(() => importProof(JSON.stringify(record)), /nested deeper/);
  record.start = `r${'2'.repeat(MAX_INPUT_LENGTH)}`;
  assert.throws(() => importProof(JSON.stringify(record)), /Generator name is longer than/);
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

test('free and unknown challenge imports preserve and enforce their recorded ruleset', () => {
  for (const challenge of ['free', 'someone-elses-challenge']) {
    const record = exportProof(createProof({
      challenge, start: expression(parseTerm('a')), goal: null, ruleset: ['cancel-inverse'],
    }));
    assert.deepEqual(importProof(JSON.stringify(record)).ruleset, record.ruleset);
    record.steps = [{ rule: 'insert-identity', path: [], start: 0, end: -1 }];
    assert.throws(() => importProof(JSON.stringify(record)), /Step 1 .*not available/);
    record.ruleset = [];
    record.steps = [];
    assert.throws(() => importProof(JSON.stringify(record)), /at least one permitted rule/);
  }
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
    start: expression(parseTerm('a')),
    goal: null,
    ruleset: ['insert-identity'],
  });
  for (let index = 0; index < 120; index += 1) {
    proof = applyRule(proof, 'insert-identity', at({ path: [], start: 0, end: -1 }));
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
