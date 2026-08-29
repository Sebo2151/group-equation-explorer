/**
 * Graduated hints, from the proof the challenge ships with.
 *
 * There is no proof search here. Searching from wherever a learner happens to
 * be is Phase 6 work, and it would be unreliable in this setting anyway: the
 * insertion laws have infinitely many instantiations, so a search would need a
 * pool of guessed terms and could fail to find a proof that plainly exists.
 * Failing to find one is not the same as there being none, and a hint that
 * quietly means "I gave up" is worse than no hint.
 *
 * So hints walk the authored reference proof, which is machine-checked against
 * exactly the challenge's own tools. They come in three grades, and the learner
 * asks for each one:
 *
 *   1. the family to look in — enough to start thinking, not enough to act;
 *   2. the law, and where on the line it applies;
 *   3. the move itself, offered as a control, so nobody is stuck.
 *
 * The interesting case is the learner who has gone somewhere else. Their line
 * may be perfectly correct and simply not on the route this file knows, and
 * pretending otherwise would either mislead them or imply they had made a
 * mistake. So divergence is detected and said out loud, with the two things
 * they can do about it: look at the route we know, or step back onto it.
 */

import {
  challengeById,
  challengeSetup,
  resolveMove,
  type Challenge,
  type Move,
} from './challenges.ts';
import { anyRuleById, findAddresses } from './catalogue.ts';
import { applyRule, createProof, currentLine, isComplete, type ProofState } from './proof.ts';
import { type RuleArgument } from './rules.ts';
import { subjectsEqual, type Address, type Subject } from './subject.ts';
import { spanSpeech, spanTerms, type Term } from './term.ts';

const FAMILY_PROSE: Record<string, string> = {
  identity: 'the identity laws',
  inverse: 'the inverse laws',
  power: 'the power laws',
  equation: 'the laws that act on the whole equation',
};

/** The reference proof, line by line, so a learner's line can be located on it. */
export function referenceLines(challenge: Challenge): ProofState | null {
  try {
    return challenge.solution.reduce((state, move) => {
      const resolved = resolveMove(currentLine(state).subject, move);
      if (!resolved) throw new RangeError('reference proof does not fit');
      return applyRule(state, move.rule, resolved.address, resolved.argument);
    }, createProof(challengeSetup(challenge)));
  } catch {
    // A reference proof that no longer fits its challenge is a bug caught by
    // test, not something to crash a learner's session over.
    return null;
  }
}

export type Hint =
  | { kind: 'none'; text: string }
  | {
      kind: 'step';
      /** 1, 2 or 3: how much has been given away so far. */
      level: number;
      text: string;
      /** Present at level 3: the move, ready to be taken. */
      offer?: { rule: Move['rule']; address: Address; argument?: RuleArgument };
      /** Whether asking again would say more. */
      more: boolean;
    }
  | { kind: 'diverged'; text: string; canRejoin: boolean };

/**
 * The hint for this state at this level.
 *
 * `level` counts how many times the learner has asked on this line, from 1.
 */
export function hintFor(state: ProofState, level: number): Hint {
  const challenge = challengeById(state.challenge);
  if (!challenge) {
    return {
      kind: 'none',
      text: 'This is your own exploration, so there is no route to walk you through.',
    };
  }
  if (isComplete(state)) {
    return { kind: 'none', text: 'You have finished this one. There is nothing left to hint at.' };
  }

  const reference = referenceLines(challenge);
  if (!reference) {
    return { kind: 'none', text: 'The worked route for this challenge is unavailable.' };
  }

  const here = currentLine(state).subject;
  const at = reference.lines.findIndex((line) => subjectsEqual(line.subject, here));

  if (at === -1) {
    return {
      kind: 'diverged',
      text: 'You have gone a different way from the route I know. Nothing is wrong with your line — I just cannot point at the next step from here.',
      canRejoin: state.index > 0,
    };
  }

  const move = challenge.solution[at];
  if (!move) {
    return { kind: 'none', text: 'The route I know ends here, and you are already at its end.' };
  }

  const resolved = resolveMove(here, move);
  if (!resolved) {
    return { kind: 'none', text: 'The route I know does not fit this line.' };
  }

  const rule = anyRuleById(move.rule);
  const places = findAddresses(here, move.rule);
  const which = (move.at ?? 1) - 1;

  if (level <= 1) {
    return {
      kind: 'step',
      level: 1,
      text: `Look among ${FAMILY_PROSE[rule.family] ?? 'the laws you have'}.`,
      more: true,
    };
  }

  if (level === 2) {
    return {
      kind: 'step',
      level: 2,
      text: `Use ${rule.name}${whereProse(here, resolved.address, places.length, which)}.`,
      more: true,
    };
  }

  return {
    kind: 'step',
    level: 3,
    text: `${rule.name}${whereProse(here, resolved.address, places.length, which)}${termProse(move)}. Here it is.`,
    offer: {
      rule: move.rule,
      address: resolved.address,
      ...(resolved.argument ? { argument: resolved.argument } : {}),
    },
    more: false,
  };
}

/** The most a hint can say before it is simply doing the step. */
export const MAX_HINT_LEVEL = 3;

/**
 * Where on the line, said the way a learner reads the line rather than the way
 * the address is stored. A whole-equation law has nowhere to point; a single
 * candidate needs no number; otherwise say which marked place, and what is
 * under it.
 */
function whereProse(
  subject: Subject,
  address: Address,
  total: number,
  which: number,
): string {
  if (address.kind === 'equation') return '';

  const side = address.kind === 'side' ? ` on the ${address.side}-hand side` : '';
  const factors = describeTarget(subject, address);
  const place = total > 1 ? ` at marked place ${which + 1}` : '';
  return `${place}${side}${factors}`;
}

function describeTarget(subject: Subject, address: Address): string {
  if (address.kind === 'equation') return '';
  const root =
    address.kind === 'side'
      ? subject.kind === 'equation'
        ? address.side === 'left'
          ? subject.left
          : subject.right
        : null
      : subject.kind === 'expression'
        ? subject.term
        : null;
  if (!root) return '';

  const { target } = address;
  if (target.end < target.start) return ', in the gap the brackets mark';

  let span: Term[];
  try {
    span = spanTerms(root, target);
  } catch {
    return '';
  }
  return span.length ? `, on ${spanSpeech(span)}` : '';
}

function termProse(move: Move): string {
  if (move.term === undefined) return '';
  const order = move.inverseFirst ? ', inverse first' : '';
  return `, with the term ${move.term}${order}`;
}

/**
 * How far back the learner would have to step to be on the known route again.
 * `null` when no line they have written is on it, which can only happen if they
 * left it before the opening line — that is, never.
 */
export function rejoinDepth(state: ProofState): number | null {
  const challenge = challengeById(state.challenge);
  if (!challenge) return null;
  const reference = referenceLines(challenge);
  if (!reference) return null;

  for (let index = state.index; index >= 0; index -= 1) {
    const subject = state.lines[index].subject;
    if (reference.lines.some((line) => subjectsEqual(line.subject, subject))) {
      return state.index - index;
    }
  }
  return null;
}
