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
import {
  anyRuleById,
  findAddresses,
  type AnyRuleId,
} from '../app/catalogue.ts';
import { type RuleArgument } from '../app/rules.ts';
import {
  expression,
  subjectSource,
  subjectTerms,
  type Address,
} from '../app/subject.ts';
import { type Term } from '../app/term.ts';

type Move = { rule: AnyRuleId; address: Address; argument?: RuleArgument };

/**
 * A bounded breadth-first search for a proof using only the challenge's own
 * permitted rules. The point is not a solver feature — it is the plan's
 * requirement that an actual proof of each challenge be checked with exactly
 * its permitted tools before shipping it.
 */
function search(state: ProofState, maxDepth: number, maxStates = 20_000): Move[] | null {
  const goal = state.goal;
  if (goal === null) return null;

  const seen = new Set([subjectSource(state.lines[0].subject)]);
  let frontier: { state: ProofState; moves: Move[] }[] = [{ state, moves: [] }];

  for (let depth = 0; depth < maxDepth; depth += 1) {
    const next: { state: ProofState; moves: Move[] }[] = [];

    for (const entry of frontier) {
      for (const move of movesFrom(entry.state)) {
        let advanced: ProofState;
        try {
          advanced = applyRule(entry.state, move.rule, move.address, move.argument);
        } catch {
          continue;
        }

        const moves = [...entry.moves, move];
        if (isComplete(advanced)) return moves;

        const key = subjectSource(advanced.lines[advanced.index].subject);
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
  const subject = state.lines[state.index].subject;
  const candidates = instantiationCandidates(state);

  return state.ruleset.flatMap((rule) =>
    findAddresses(subject, rule).flatMap((address) =>
      anyRuleById(rule).needsTerm
        ? candidates.flatMap((candidate) => [
            { rule, address, argument: { term: candidate } },
            { rule, address, argument: { term: candidate, inverseFirst: true } },
          ])
        : [{ rule, address }],
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
  subjectTerms(state.start).forEach(collect);
  if (state.goal) subjectTerms(state.goal).forEach(collect);
  return [...names].sort().map((name) => parseTerm(name));
}

/* ------------------------------------------------------------------ */

test('every challenge parses, and its goal is not its start', () => {
  for (const challenge of CHALLENGES) {
    const setup = challengeSetup(challenge);
    assert.ok(setup.goal, `${challenge.id} has no goal`);
    assert.notEqual(
      subjectSource(setup.start),
      subjectSource(setup.goal!),
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
    for (const rule of challenge.rules) assert.doesNotThrow(() => anyRuleById(rule));
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
  const free = createProof(freeSetup(expression(parseTerm('a a^-1'))));
  assert.deepEqual(free.ruleset, FREE_RULES);
  assert.equal(free.goal, null);
  assert.equal(isComplete(free), false);
});

test('free exploration can be given a goal', () => {
  const free = createProof(freeSetup(expression(parseTerm('a a^-1')), expression(parseTerm('e'))));
  assert.ok(search(free, 2));
});
