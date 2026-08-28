/**
 * Proof history as a DOM-free reducer.
 *
 * A step records the rule, the exact target, and any instantiated term — not
 * just the label the sheet displays. That is what an independent replay check
 * needs, and replay is what makes an imported proof evidence of anything.
 */

import {
  applyRule as applyRuleToTerm,
  isRuleId,
  validateArgument,
  type RuleArgument,
  type RuleId,
} from './rules.ts';
import { termsEqual, type Target, type Term } from './term.ts';

export type ProofStep = {
  rule: RuleId;
  target: Target;
  argument?: RuleArgument;
  reason: string;
  detail: string;
};

export type ProofLine = {
  term: Term;
  /** Absent on the opening line, which is asserted rather than derived. */
  step?: ProofStep;
};

export type ProofState = {
  /** Which challenge this proof belongs to, or `free` for exploration. */
  challenge: string;
  start: Term;
  /** The term to reach, or `null` when there is nothing to reach. */
  goal: Term | null;
  /**
   * The rules this proof was built with. Frozen for the life of the proof: a
   * score means nothing unless the tools that produced it are recorded too.
   */
  ruleset: RuleId[];
  lines: ProofLine[];
  /** Cursor into `lines`. Lines after it are the redo branch. */
  index: number;
};

export type ProofSetup = {
  challenge: string;
  start: Term;
  goal: Term | null;
  ruleset: RuleId[];
};

/** Longest proof the app will build or accept. */
export const MAX_STEPS = 200;

export function createProof(setup: ProofSetup): ProofState {
  const ruleset = normalizeRuleset(setup.ruleset);
  return {
    challenge: setup.challenge,
    start: setup.start,
    goal: setup.goal,
    ruleset,
    lines: [{ term: setup.start }],
    index: 0,
  };
}

function normalizeRuleset(ruleset: unknown): RuleId[] {
  if (!Array.isArray(ruleset)) throw new TypeError('Ruleset must be a list of rule ids.');
  const seen: RuleId[] = [];
  for (const id of ruleset) {
    if (!isRuleId(id)) throw new TypeError(`Unknown rule id ${JSON.stringify(id)}.`);
    if (!seen.includes(id)) seen.push(id);
  }
  if (seen.length === 0) throw new TypeError('A proof needs at least one permitted rule.');
  return seen;
}

export function currentLine(state: ProofState): ProofLine {
  return state.lines[state.index];
}

/** Lines visible on the sheet: the opening line through the cursor. */
export function visibleLines(state: ProofState): ProofLine[] {
  return state.lines.slice(0, state.index + 1);
}

/** Committed mathematical transformations, not taps or selections. */
export function stepCount(state: ProofState): number {
  return state.index;
}

export function canUndo(state: ProofState): boolean {
  return state.index > 0;
}

export function canRedo(state: ProofState): boolean {
  return state.index < state.lines.length - 1;
}

export function ruleAllowed(state: ProofState, rule: RuleId): boolean {
  return state.ruleset.includes(rule);
}

/**
 * Append one justified transformation. Any redo branch is discarded: the
 * abandoned future must not be reachable again by pressing Redo.
 */
export function applyRule(
  state: ProofState,
  rule: RuleId,
  target: Target,
  argument?: RuleArgument,
): ProofState {
  if (!ruleAllowed(state, rule)) {
    throw new RangeError(`Rule ${rule} is not available in this challenge.`);
  }
  if (state.index >= MAX_STEPS) {
    throw new RangeError(`A proof may not exceed ${MAX_STEPS} steps.`);
  }

  const checked = argument === undefined ? undefined : validateArgument(argument, rule);
  const result = applyRuleToTerm(currentLine(state).term, rule, target, checked);
  const kept = state.lines.slice(0, state.index + 1);

  return {
    ...state,
    lines: [
      ...kept,
      {
        term: result.term,
        step: {
          rule: result.rule,
          target: result.target,
          ...(result.argument ? { argument: result.argument } : {}),
          reason: result.reason,
          detail: result.detail,
        },
      },
    ],
    index: kept.length,
  };
}

export function undo(state: ProofState): ProofState {
  return canUndo(state) ? { ...state, index: state.index - 1 } : state;
}

export function redo(state: ProofState): ProofState {
  return canRedo(state) ? { ...state, index: state.index + 1 } : state;
}

export function restart(state: ProofState): ProofState {
  return createProof(state);
}

/**
 * Compare terms, not rendered TeX. Distinct terms can print the same way once
 * subscripts and parentheses are involved, and a goal check must tell them apart.
 */
export function isComplete(state: ProofState): boolean {
  return state.goal !== null && termsEqual(currentLine(state).term, state.goal);
}

/**
 * Rebuild a proof from its recorded steps, checking every one against the same
 * rule contracts the UI uses. A displayed reason is an annotation; this is the
 * only thing that makes a stored proof believable.
 */
export function replayProof(
  setup: ProofSetup,
  steps: { rule: RuleId; target: Target; argument?: RuleArgument }[],
): ProofState {
  if (!Array.isArray(steps)) throw new TypeError('Steps must be a list.');
  if (steps.length > MAX_STEPS) {
    throw new RangeError(`A proof may not exceed ${MAX_STEPS} steps.`);
  }

  return steps.reduce(
    (state, step, index) => {
      if (!isRuleId(step?.rule)) {
        throw new TypeError(`Step ${index + 1}: unknown rule id.`);
      }
      try {
        return applyRule(state, step.rule, step.target, step.argument);
      } catch (error) {
        throw new RangeError(
          `Step ${index + 1} (${step.rule}) does not check out: ${(error as Error).message}`,
        );
      }
    },
    createProof(setup),
  );
}

/** Replay a proof state against itself. Used to verify before export. */
export function verifyProof(state: ProofState): ProofState {
  return replayProof(state, replayableSteps(state));
}

export function replayableSteps(
  state: ProofState,
): { rule: RuleId; target: Target; argument?: RuleArgument }[] {
  return visibleLines(state)
    .slice(1)
    .map(({ step }) => ({
      rule: step!.rule,
      target: step!.target,
      ...(step!.argument ? { argument: step!.argument } : {}),
    }));
}
