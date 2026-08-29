import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  benchmarkSteps,
  CHALLENGES,
  COURSE_CHAPTERS,
  challengeSetup,
  FREE_RULES,
  freeSetup,
  grantedBy,
  isPrimitiveRule,
  resolveMove,
  type Challenge,
} from '../app/challenges.ts';
import { exactGoal } from '../app/goal.ts';
import { parseTerm } from '../app/parse.ts';
import {
  applyRule,
  createProof,
  currentLine,
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
function search(state: ProofState, maxDepth: number, maxStates = 120_000): Move[] | null {
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

/**
 * The terms a proof might need to name: the generators the challenge mentions,
 * and their inverses. The inverses are what makes the equation challenges
 * reachable at all — clearing an `a` from a side means multiplying by `a^-1`,
 * which is not a generator and so would never be tried otherwise.
 */
function instantiationCandidates(state: ProofState): Term[] {
  const names = new Set<string>();
  const collect = (term: Term) => {
    if (term.kind === 'generator') names.add(term.name);
    if (term.kind === 'product') term.factors.forEach(collect);
    if (term.kind === 'inverse') collect(term.term);
    if (term.kind === 'power') collect(term.base);
  };
  subjectTerms(state.start).forEach(collect);
  if (state.goal?.kind === 'exact') subjectTerms(state.goal.subject).forEach(collect);

  return [...names]
    .sort()
    .flatMap((name) => [parseTerm(name), parseTerm(`${name}^-1`)]);
}

/** Walk a challenge's authored reference proof, one written move at a time. */
function walkSolution(challenge: Challenge): ProofState {
  const setup = challengeSetup(challenge);
  return challenge.solution.reduce((state, move, index) => {
    const resolved = resolveMove(currentLine(state).subject, move);
    assert.ok(
      resolved,
      `${challenge.id} step ${index + 1}: ${move.rule} has no place ${move.at ?? 1} on this line`,
    );
    return applyRule(state, move.rule, resolved!.address, resolved!.argument);
  }, createProof(setup));
}

/* ------------------------------------------------------------------ */

test('every challenge parses, and its goal is not its start', () => {
  for (const challenge of CHALLENGES) {
    const setup = challengeSetup(challenge);
    assert.ok(setup.goal, `${challenge.id} has no goal`);
    assert.equal(
      isComplete(createProof(setup)),
      false,
      `${challenge.id} starts at its goal`,
    );
  }
});

test('challenge ids and labels are unique', () => {
  assert.equal(new Set(CHALLENGES.map((entry) => entry.id)).size, CHALLENGES.length);
  assert.equal(new Set(CHALLENGES.map((entry) => entry.label)).size, CHALLENGES.length);
});

test('every chapter is populated, contiguous, and pedagogically described', () => {
  const chapterIds = COURSE_CHAPTERS.map((chapter) => chapter.id);
  const seen: string[] = [];

  for (const challenge of CHALLENGES) {
    assert.ok(chapterIds.includes(challenge.chapter), `${challenge.id} names an unknown chapter`);
    assert.ok(challenge.objective.trim(), `${challenge.id} needs a learning objective`);
    assert.ok(challenge.prompt.trim(), `${challenge.id} needs a prediction prompt`);
    assert.ok(challenge.takeaway.trim(), `${challenge.id} needs a takeaway`);
    if (seen.at(-1) !== challenge.chapter) seen.push(challenge.chapter);
  }

  assert.deepEqual(seen, chapterIds, 'chapters should appear once, in course order');
  for (const chapter of COURSE_CHAPTERS) {
    assert.ok(CHALLENGES.some((challenge) => challenge.chapter === chapter.id));
    assert.ok(chapter.description.trim());
    assert.ok(chapter.outcome.trim());
  }
});

test('every challenge names only rules that exist', () => {
  for (const challenge of CHALLENGES) {
    assert.ok(challenge.rules.length > 0, `${challenge.id} permits nothing`);
    for (const rule of challenge.rules) assert.doesNotThrow(() => anyRuleById(rule));
  }
});

/* ------------------------------------------------------------------ */
/* Reference proofs                                                    */
/* ------------------------------------------------------------------ */

/**
 * The plan's instruction is to author and check an actual proof of each
 * challenge with exactly its permitted tools before shipping it. This is that
 * check, run against the written-down proof rather than one a search happened
 * to find — because the written one is also what the hints walk a learner
 * through, so it has to be a route a person would actually take.
 */
test('every challenge has an authored proof that checks out', () => {
  for (const challenge of CHALLENGES) {
    const finished = walkSolution(challenge);
    assert.ok(isComplete(finished), `${challenge.id}: the authored proof does not reach the goal`);
    assert.equal(
      finished.index,
      benchmarkSteps(challenge),
      `${challenge.id}: benchmark length disagrees with the authored proof`,
    );
  }
});

/**
 * A benchmark that can be beaten is fine; a benchmark that is beaten by a step
 * the author did not notice is a sign the challenge is not asking what it
 * meant to. This does not claim the authored proof is globally shortest — the
 * search is bounded and its instantiations are a guess — only that nothing
 * shorter turned up within reach.
 */
test('no challenge has a proof shorter than the one it ships', () => {
  for (const challenge of CHALLENGES) {
    const benchmark = benchmarkSteps(challenge);
    if (benchmark <= 1) continue;
    const shorter = search(createProof(challengeSetup(challenge)), benchmark - 1);
    assert.equal(
      shorter,
      null,
      `${challenge.id} ships a ${benchmark}-step proof but can be done in ${shorter?.length}`,
    );
  }
});

/* ------------------------------------------------------------------ */
/* Dependencies                                                        */
/* ------------------------------------------------------------------ */

/**
 * The heart of the phase's acceptance criterion: no circular proofs.
 *
 * A law is either primitive — an axiom, or the definition of a notation — or it
 * is derived, and a derived law may not be used before the challenge that
 * proves it. Checking it this way means a new challenge cannot quietly hand a
 * theorem to a learner who has not seen where it comes from, and a lemma
 * challenge cannot quietly be given itself.
 */
test('no challenge uses a derived law before it has been earned', () => {
  const earned = new Set<AnyRuleId>();

  for (const challenge of CHALLENGES) {
    for (const rule of challenge.rules) {
      assert.ok(
        isPrimitiveRule(rule) || earned.has(rule),
        `${challenge.id} uses ${rule}, which is derived and not yet proved`,
      );
    }
    for (const granted of challenge.grants ?? []) {
      assert.ok(
        !isPrimitiveRule(granted),
        `${challenge.id} claims to earn ${granted}, which is primitive`,
      );
      assert.ok(!earned.has(granted), `${granted} is earned more than once`);
      assert.ok(
        !challenge.rules.includes(granted),
        `${challenge.id} is given ${granted}, the very law it exists to prove`,
      );
      earned.add(granted);
    }
  }
});

test('every derived law is earned somewhere, and every primitive law is not', () => {
  for (const rule of FREE_RULES) {
    const granted = grantedBy(rule);
    assert.equal(
      granted === undefined,
      isPrimitiveRule(rule),
      `${rule} is ${isPrimitiveRule(rule) ? 'primitive but earned' : 'derived but never earned'}`,
    );
  }
});

/**
 * The unlock order has to be a chain the app can actually walk: each challenge
 * names the one before it, and nothing names itself or something later.
 */
test('the unlock order is a chain, in list order', () => {
  CHALLENGES.forEach((challenge, index) => {
    if (index === 0) {
      assert.equal(challenge.requires, undefined, 'the first challenge requires nothing');
      return;
    }
    assert.equal(
      challenge.requires,
      CHALLENGES[index - 1].id,
      `${challenge.id} does not follow on from the challenge before it`,
    );
  });
});

/* ------------------------------------------------------------------ */
/* Load-bearing tools                                                  */
/* ------------------------------------------------------------------ */

/**
 * A lemma challenge is worth nothing if the lemma it proves would have made it
 * trivial, and an application challenge is worth nothing if the lemma it is
 * meant to exercise turns out not to be needed. Both directions are checked.
 */
test('each lemma challenge is genuinely harder without its own lemma', () => {
  for (const challenge of CHALLENGES) {
    const grants = challenge.grants ?? [];
    if (grants.length === 0) continue;

    // At least one of them, not every one. A lemma is earned together with its
    // converse — `double-inverse` with `wrap-double-inverse`, distributing an
    // inverse with collecting one — and only the direction the challenge is
    // stated in can shorten it. Requiring both would assert something that is
    // not true of a correctly-built pair, and the invariant being protected is
    // that the challenge is not already solvable by the thing it proves.
    const shortcut = grants.some((granted) =>
      search(
        createProof({ ...challengeSetup(challenge), ruleset: [...challenge.rules, granted] }),
        benchmarkSteps(challenge) - 1,
      ),
    );
    assert.ok(
      shortcut,
      `${challenge.id} is no easier with ${grants.join(' or ')}, so it is not really proving them`,
    );
  }
});

test('each application challenge actually needs the law it introduces', () => {
  const introduced: Record<string, AnyRuleId> = {
    'double-inverse': 'double-inverse',
    'socks-and-shoes': 'inverse-of-product',
    'solve-left': 'left-multiply',
    'solve-right': 'right-multiply',
    'read-it-backwards': 'symmetry',
    'inverses-of-equals': 'invert-both-sides',
    cancellation: 'left-multiply',
    'use-cancellation': 'cancel-left',
  };

  for (const [id, rule] of Object.entries(introduced)) {
    const challenge = CHALLENGES.find((entry) => entry.id === id)!;
    const without = {
      ...challengeSetup(challenge),
      ruleset: challenge.rules.filter((entry) => entry !== rule),
    };
    assert.ok(without.ruleset.length > 0, `${id} has nothing left without ${rule}`);
    assert.equal(search(createProof(without), 6), null, `${id} does not actually need ${rule}`);
  }
});

/* ------------------------------------------------------------------ */
/* Free exploration                                                    */
/* ------------------------------------------------------------------ */

test('free exploration permits the whole catalogue and never completes', () => {
  const free = createProof(freeSetup(expression(parseTerm('a a^-1'))));
  assert.deepEqual(free.ruleset, FREE_RULES);
  assert.equal(free.goal, null);
  assert.equal(isComplete(free), false);
});

test('free exploration can be given a goal', () => {
  const free = createProof(
    freeSetup(expression(parseTerm('a a^-1')), exactGoal(expression(parseTerm('e')))),
  );
  assert.ok(search(free, 2));
});

test('a challenge proof replays from its own recorded steps', () => {
  for (const challenge of CHALLENGES) {
    const finished = walkSolution(challenge);
    const replayed = replayProof(
      challengeSetup(challenge),
      finished.lines.slice(1).map(({ step }) => ({
        rule: step!.rule,
        address: step!.address,
        ...(step!.argument ? { argument: step!.argument } : {}),
      })),
    );
    assert.ok(isComplete(replayed), `${challenge.id} does not replay to its goal`);
  }
});
