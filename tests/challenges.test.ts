import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CHALLENGES, challengeSetup, FREE_RULES, freeSetup } from '../app/challenges.ts';
import { parseTerm } from '../app/parse.ts';
import {
  applyRule,
  createProof,
  isComplete,
  replayProof,
  type ProofState,
} from '../app/proof.ts';
import { findTargets, ruleById, type RuleArgument, type RuleId } from '../app/rules.ts';
import { termSource, type Target, type Term } from '../app/term.ts';

type Move = { rule: RuleId; target: Target; argument?: RuleArgument };

/**
 * A bounded breadth-first search for a proof using only the challenge's own
 * permitted rules. The point is not a solver feature — it is the plan's
 * requirement that an actual proof of each challenge be checked with exactly
 * its permitted tools before shipping it.
 */
function search(state: ProofState, maxDepth: number, maxStates = 20_000): Move[] | null {
  const goal = state.goal;
  if (goal === null) return null;

  const seen = new Set([termSource(state.lines[0].term)]);
  let frontier: { state: ProofState; moves: Move[] }[] = [{ state, moves: [] }];

  for (let depth = 0; depth < maxDepth; depth += 1) {
    const next: { state: ProofState; moves: Move[] }[] = [];

    for (const entry of frontier) {
      for (const move of movesFrom(entry.state)) {
        let advanced: ProofState;
        try {
          advanced = applyRule(entry.state, move.rule, move.target, move.argument);
        } catch {
          continue;
        }

        const moves = [...entry.moves, move];
        if (isComplete(advanced)) return moves;

        const key = termSource(advanced.lines[advanced.index].term);
        if (seen.has(key)) continue;
        seen.add(key);
        if (seen.size > maxStates) return null;
        next.push({ state: advanced, moves });
      }
    }

    frontier = next;
    if (frontier.length === 0) break;
  }

  return null;
}

function movesFrom(state: ProofState): Move[] {
  const term = state.lines[state.index].term;
  const candidates = instantiationCandidates(state);

  return state.ruleset.flatMap((rule) =>
    findTargets(term, rule).flatMap((target) =>
      ruleById(rule).needsTerm
        ? candidates.flatMap((candidate) => [
            { rule, target, argument: { term: candidate } },
            { rule, target, argument: { term: candidate, inverseFirst: true } },
          ])
        : [{ rule, target }],
    ),
  );
}

/** Generators mentioned by the challenge, which is all a proof should need. */
function instantiationCandidates(state: ProofState): Term[] {
  const names = new Set<string>();
  const collect = (term: Term) => {
    if (term.kind === 'generator') names.add(term.name);
    if (term.kind === 'product') term.factors.forEach(collect);
    if (term.kind === 'inverse') collect(term.term);
    if (term.kind === 'power') collect(term.base);
  };
  collect(state.start);
  if (state.goal) collect(state.goal);
  return [...names].sort().map((name) => parseTerm(name));
}

/* ------------------------------------------------------------------ */

test('every challenge parses, and its goal is not its start', () => {
  for (const challenge of CHALLENGES) {
    const setup = challengeSetup(challenge);
    assert.ok(setup.goal, `${challenge.id} has no goal`);
    assert.notEqual(
      termSource(setup.start),
      termSource(setup.goal!),
      `${challenge.id} starts at its goal`,
    );
  }
});

test('challenge ids and labels are unique', () => {
  assert.equal(new Set(CHALLENGES.map((entry) => entry.id)).size, CHALLENGES.length);
  assert.equal(new Set(CHALLENGES.map((entry) => entry.label)).size, CHALLENGES.length);
});

test('every challenge names only rules that exist', () => {
  for (const challenge of CHALLENGES) {
    assert.ok(challenge.rules.length > 0, `${challenge.id} permits nothing`);
    for (const rule of challenge.rules) assert.doesNotThrow(() => ruleById(rule));
  }
});

test('every challenge is provable using only the tools it permits', () => {
  for (const challenge of CHALLENGES) {
    const setup = challengeSetup(challenge);
    const proof = createProof(setup);
    const moves = search(proof, 6);

    assert.ok(moves, `${challenge.id} has no proof within six of its own steps`);

    // And the proof it found actually checks out under the same contracts.
    const replayed = replayProof(setup, moves!);
    assert.ok(isComplete(replayed), `${challenge.id}: found chain does not reach the goal`);
  }
});

test('the socks-and-shoes challenge is not solvable without socks and shoes', () => {
  // The lemma is a permitted tool here, so the challenge is an exercise in
  // using it. This records that it is load-bearing: remove it and the
  // challenge becomes unreachable rather than merely longer.
  const challenge = CHALLENGES.find((entry) => entry.id === 'socks-and-shoes')!;
  const without = {
    ...challengeSetup(challenge),
    ruleset: challenge.rules.filter((rule) => rule !== 'inverse-of-product'),
  };
  assert.equal(search(createProof(without), 5), null);
});

test('free exploration permits the whole catalogue and never completes', () => {
  const free = createProof(freeSetup(parseTerm('a a^-1')));
  assert.deepEqual(free.ruleset, FREE_RULES);
  assert.equal(free.goal, null);
  assert.equal(isComplete(free), false);
});

test('free exploration can be given a goal', () => {
  const free = createProof(freeSetup(parseTerm('a a^-1'), parseTerm('e')));
  assert.ok(search(free, 2));
});
