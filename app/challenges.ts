/**
 * Challenge data.
 *
 * A challenge names its permitted rules explicitly. That is the mechanism the
 * plan asks for against circular proofs: a challenge whose point is a lemma
 * must not list that lemma among its tools, and the ruleset travels with the
 * proof so a later change to the catalogue cannot silently re-interpret an old
 * record.
 *
 * These are ordered for a first course, not gated: unlocks and progress belong
 * to Phase 4.
 */

import { parseSubject } from './parse.ts';
import { ALL_RULE_IDS, type AnyRuleId } from './catalogue.ts';
import type { Subject } from './subject.ts';

export type Challenge = {
  id: string;
  label: string;
  title: string;
  blurb: string;
  /** Source text, parsed on demand so the data stays readable and diffable. */
  start: string;
  goal: string | null;
  rules: AnyRuleId[];
};

export const FREE_CHALLENGE_ID = 'free';

/** Everything in the catalogue. Free exploration is not a graded challenge. */
export const FREE_RULES: AnyRuleId[] = ALL_RULE_IDS;

export const CHALLENGES: Challenge[] = [
  {
    id: 'cancel-pairs',
    label: '01',
    title: 'Cancel what undoes itself',
    blurb: 'Two inverse pairs are hiding in this product. Take them out one at a time.',
    start: 'a a^-1 b c^-1 c',
    goal: 'b',
    rules: ['cancel-inverse', 'remove-identity'],
  },
  {
    id: 'insert-a-pair',
    label: '02',
    title: 'Put something in',
    blurb:
      'Every step so far removed something. Multiplying by a term and its inverse changes nothing — and it is how most real proofs start.',
    start: 'b',
    goal: 'a^-1 a b',
    rules: ['insert-inverse-pair', 'insert-identity', 'remove-identity', 'cancel-inverse'],
  },
  {
    id: 'double-inverse',
    label: '03',
    title: 'Undo an undoing',
    blurb: 'The inverse of an inverse is where it started. Then the rest cancels.',
    start: '(a^-1)^-1 b^-1 b',
    goal: 'a',
    rules: ['double-inverse', 'cancel-inverse', 'remove-identity'],
  },
  {
    id: 'socks-and-shoes',
    label: '04',
    title: 'Socks and shoes',
    blurb:
      'Inverting a product reverses it. Distribute the inverse, then let the middle collapse.',
    start: '(ab)^-1 a b',
    goal: 'e',
    rules: ['inverse-of-product', 'cancel-inverse', 'remove-identity'],
  },
  {
    id: 'nested-inverse',
    label: '05',
    title: 'Reach inside',
    blurb: 'The target is nested. Distribute first, then clean up what that exposes.',
    start: '(a b^-1)^-1',
    goal: 'b a^-1',
    rules: ['inverse-of-product', 'double-inverse', 'combine-inverses'],
  },
  {
    id: 'powers',
    label: '06',
    title: 'Powers are shorthand',
    blurb:
      'A power abbreviates a repeated product. Add the exponents, or write them out and cancel — both are proofs.',
    start: 'a^3 a^-2',
    goal: 'a',
    rules: [
      'combine-powers',
      'expand-power',
      'cancel-inverse',
      'remove-identity',
      'zero-power',
      'negative-power',
      'inverse-of-power',
    ],
  },

  /*
   * From here the line is an equation rather than an expression. The rules that
   * act on the statement as a whole arrive one at a time, so each challenge
   * introduces a single new move.
   *
   * Cancellation is not in the catalogue: it is derivable, and challenge 09 is
   * where it gets derived. A later phase can grant it as a tool once it has
   * been earned, which is exactly the socks-and-shoes pattern.
   */
  {
    id: 'solve-left',
    label: '07',
    title: 'Solve for x',
    blurb:
      'x is trapped behind an a. Multiplying both sides by the same term keeps the equation true — choose the term that clears it.',
    start: 'a x = b',
    goal: 'x = a^-1 b',
    rules: ['left-multiply', 'cancel-inverse', 'remove-identity'],
  },
  {
    id: 'solve-right',
    label: '08',
    title: 'The other side',
    blurb:
      'The same problem with the a on the right. The group is not assumed commutative, so the side you multiply on matters.',
    start: 'x a = b',
    goal: 'x = b a^-1',
    rules: ['right-multiply', 'cancel-inverse', 'remove-identity'],
  },
  {
    id: 'read-it-backwards',
    label: '09',
    title: 'Read it the other way',
    blurb:
      'An equation says the same thing in either direction — but saying it the other way round is still a step.',
    start: 'b = a x',
    goal: 'x = a^-1 b',
    rules: ['symmetry', 'left-multiply', 'cancel-inverse', 'remove-identity'],
  },
  {
    id: 'inverses-of-equals',
    label: '10',
    title: 'Inverses of equals',
    blurb:
      'Equal terms have equal inverses. Invert both sides, then remember what inverting a product does to the order.',
    start: 'x = a b',
    goal: 'x^-1 = b^-1 a^-1',
    rules: ['invert-both-sides', 'inverse-of-product'],
  },
  {
    id: 'cancellation',
    label: '11',
    title: 'Cancel a common factor',
    blurb:
      'If a x and a y are equal, then x and y are. This is the cancellation law — and it is a theorem, not an axiom, so here it is proved.',
    start: 'a x = a y',
    goal: 'x = y',
    rules: ['left-multiply', 'cancel-inverse', 'remove-identity'],
  },
];

export function challengeById(id: string): Challenge | undefined {
  return CHALLENGES.find((challenge) => challenge.id === id);
}

export type ChallengeSetup = {
  challenge: string;
  start: Subject;
  goal: Subject | null;
  ruleset: AnyRuleId[];
};

export function challengeSetup(challenge: Challenge): ChallengeSetup {
  return {
    challenge: challenge.id,
    start: parseSubject(challenge.start, `challenge ${challenge.id} start`),
    goal:
      challenge.goal === null
        ? null
        : parseSubject(challenge.goal, `challenge ${challenge.id} goal`),
    ruleset: challenge.rules,
  };
}

export function freeSetup(start: Subject, goal: Subject | null = null): ChallengeSetup {
  return { challenge: FREE_CHALLENGE_ID, start, goal, ruleset: FREE_RULES };
}
