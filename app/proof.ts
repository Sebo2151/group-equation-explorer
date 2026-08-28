import {
  applyTransformation,
  cloneFactors,
  type Factor,
  type RuleId,
  type Target,
} from './core.ts';

/**
 * What a committed move records. This is deliberately more than the label the
 * UI shows: the rule and target are what an independent replay check needs.
 */
export type ProofStep = {
  rule: RuleId;
  target: Target;
  reason: string;
  detail: string;
};

export type ProofLine = {
  factors: Factor[];
  /** Absent on the opening line, which is asserted rather than derived. */
  step?: ProofStep;
};

export type ProofState = {
  lines: ProofLine[];
  /** Cursor into `lines`. Lines after it are the redo branch. */
  index: number;
};

export function createProof(start: Factor[]): ProofState {
  return { lines: [{ factors: cloneFactors(start) }], index: 0 };
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

/**
 * Append one justified transformation. Any redo branch is discarded: the
 * abandoned future must not be reachable again by pressing Redo.
 */
export function applyRule(state: ProofState, rule: RuleId, target: Target): ProofState {
  const { factors, reason, detail } = applyTransformation(currentLine(state).factors, rule, target);
  const kept = state.lines.slice(0, state.index + 1);

  return {
    lines: [...kept, { factors, step: { rule, target, reason, detail } }],
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
  return createProof(state.lines[0].factors);
}

export function factorsEqual(left: Factor[], right: Factor[]): boolean {
  return (
    left.length === right.length &&
    left.every((factor, index) => {
      const other = right[index];
      return (
        factor.base === other.base &&
        Boolean(factor.inverse) === Boolean(other.inverse) &&
        Boolean(factor.identity) === Boolean(other.identity)
      );
    })
  );
}

/**
 * Compare terms, not rendered TeX. The empty product and an explicit identity
 * both display as `e`; a goal check must be able to tell them apart.
 */
export function isComplete(state: ProofState, goal: Factor[]): boolean {
  return factorsEqual(currentLine(state).factors, goal);
}
