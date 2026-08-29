/**
 * What a challenge asks you to reach.
 *
 * Until now a goal was one exact subject, and finishing meant landing on it
 * character for character. That is right for "simplify this to `b`", and wrong
 * for "solve for x": `a x = b` is solved by `x = a^-1 b`, and a learner who
 * multiplies on the right first and arrives at some other equally-solved form
 * has solved it too. Refusing that would fail the phase's own acceptance
 * criterion, that valid alternative proofs receive credit.
 *
 * So a goal is one of two things. An `exact` goal is the old behaviour,
 * unchanged and still orientation sensitive — reaching `v = u` when the goal is
 * `u = v` leaves symmetry still to be spent. An `isolated` goal names a
 * variable and a side, and is reached when that variable stands alone there and
 * has been eliminated from the other side.
 *
 * Deliberately only these two. A general pattern language for goals — holes,
 * "no inverses remain", conjunctions — is a larger surface to test and to
 * explain than the curriculum currently needs.
 */

import {
  isEquation,
  sideTerm,
  subjectSource,
  subjectSpeech,
  subjectTex,
  subjectsEqual,
  type Side,
  type Subject,
} from './subject.ts';
import { GENERATOR_PATTERN, type Term } from './term.ts';

export type Goal =
  | { kind: 'exact'; subject: Subject }
  /** That variable, alone on that side, and absent from the other. */
  | { kind: 'isolated'; variable: string; side: Side };

export function exactGoal(subject: Subject): Goal {
  return { kind: 'exact', subject };
}

export function isolatedGoal(variable: string, side: Side): Goal {
  if (!GENERATOR_PATTERN.test(variable)) {
    throw new TypeError(`${JSON.stringify(variable)} is not a generator name.`);
  }
  return { kind: 'isolated', variable, side };
}

/* ------------------------------------------------------------------ */
/* Reaching one                                                        */
/* ------------------------------------------------------------------ */

/**
 * Whether this line finishes the challenge.
 *
 * The second condition on an isolated goal is the one that matters: `x = x b`
 * has x alone on the left and is not solved for x. Solving means the variable
 * has been eliminated from the other side, not merely that it stands by itself
 * on this one.
 */
export function goalReached(subject: Subject, goal: Goal): boolean {
  if (goal.kind === 'exact') return subjectsEqual(subject, goal.subject);
  if (!isEquation(subject)) return false;

  const here = sideTerm(subject, goal.side);
  if (here.kind !== 'generator' || here.name !== goal.variable) return false;

  const other = sideTerm(subject, goal.side === 'left' ? 'right' : 'left');
  return !mentions(other, goal.variable);
}

export function mentions(term: Term, name: string): boolean {
  switch (term.kind) {
    case 'generator':
      return term.name === name;
    case 'identity':
      return false;
    case 'product':
      return term.factors.some((factor) => mentions(factor, name));
    case 'inverse':
      return mentions(term.term, name);
    case 'power':
      return mentions(term.base, name);
  }
}

export function goalsEqual(left: Goal | null, right: Goal | null): boolean {
  if (left === null || right === null) return left === right;
  if (left.kind !== right.kind) return false;
  if (left.kind === 'exact') {
    return subjectsEqual(left.subject, (right as { subject: Subject }).subject);
  }
  const other = right as { variable: string; side: Side };
  return left.variable === other.variable && left.side === other.side;
}

/* ------------------------------------------------------------------ */
/* Saying one                                                          */
/* ------------------------------------------------------------------ */

/** The mathematics of the goal, for the header. Empty for a shape. */
export function goalTex(goal: Goal): string {
  return goal.kind === 'exact' ? subjectTex(goal.subject) : goal.variable;
}

/** Screen-reader form. TeX source must never reach an accessible name. */
export function goalSpeech(goal: Goal): string {
  return goal.kind === 'exact'
    ? subjectSpeech(goal.subject)
    : `${goal.variable} alone on the ${goal.side}`;
}

/** Prose for the challenge header, read by someone who has not started yet. */
export function goalProse(goal: Goal | null): string {
  if (goal === null) return 'No target. Rewrite it however you like.';
  return goal.kind === 'exact'
    ? 'Reach'
    : `Get ${goal.variable} by itself on the ${goal.side}, with no ${goal.variable} left on the other side.`;
}

/* ------------------------------------------------------------------ */
/* Records                                                             */
/* ------------------------------------------------------------------ */

/**
 * How a goal travels in an exported proof. An exact goal is its source text,
 * as it always was; a shape is an object, so the two can never be confused for
 * one another by a reader or by the validator.
 */
export type GoalRecord = string | { isolate: string; side: Side };

export function goalRecord(goal: Goal | null): GoalRecord | null {
  if (goal === null) return null;
  return goal.kind === 'exact'
    ? subjectSource(goal.subject)
    : { isolate: goal.variable, side: goal.side };
}
