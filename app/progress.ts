/**
 * What this device remembers.
 *
 * Progress is one thing: for each challenge, the shortest proof of it this
 * device has actually seen. Everything else the interface shows — which
 * challenges are unlocked, which laws have been earned, what a personal best
 * is, whether a proof can be looked at again — is derived from that, so there
 * is nothing to keep in step and nothing that can disagree.
 *
 * The record is a *proof*, not a flag. That is the point. The plan is explicit
 * that persisted data must be validated rather than trusted as unlock evidence,
 * and a stored `{"cancellation": true}` could be typed into a console by
 * anyone. A stored proof cannot: reading it back replays every step through the
 * same rule contracts the interface uses, against the challenge's own frozen
 * ruleset, and a record that does not check out is dropped rather than
 * believed. Editing the file to unlock something is therefore exactly as much
 * work as proving the theorem.
 *
 * Nothing here touches `window` or `localStorage`; `storage.ts` does that. This
 * is a pure translation between untrusted data and a progress value, so it can
 * be tested without a browser.
 */

import {
  benchmarkSteps,
  CHALLENGES,
  challengeById,
  type Challenge,
} from './challenges.ts';
import { type AnyRuleId } from './catalogue.ts';
import { isComplete, stepCount, type ProofState } from './proof.ts';
import { exportProof, importProofRecord, type ProofRecord } from './serialize.ts';

export const PROGRESS_FORMAT = 'group-equation-explorer/progress';
export const PROGRESS_VERSION = 1;

/**
 * Bounds the work a stored file can cause before any of it is replayed. There
 * there are twenty-one challenges; anything claiming far more is not ours.
 */
const MAX_ENTRIES = 100;

export type Best = {
  /** Committed transformations, not taps. */
  steps: number;
  /**
   * The tools that proof was built with. A score is only comparable to another
   * score made with the same tools, so the two always travel together.
   */
  ruleset: AnyRuleId[];
  record: ProofRecord;
};

export type Progress = {
  format: string;
  version: number;
  best: Record<string, Best>;
};

export function emptyProgress(): Progress {
  return { format: PROGRESS_FORMAT, version: PROGRESS_VERSION, best: {} };
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

export type ProgressReading = {
  progress: Progress;
  /**
   * Challenges whose stored proof did not check out and was dropped. The
   * interface says so rather than silently showing less progress than the
   * learner remembers earning.
   */
  discarded: string[];
};

/**
 * Read stored progress, keeping only what replays.
 *
 * One bad entry loses that entry, not the whole file: a learner who edited one
 * line, or who has a record from before a challenge was rewritten, should not
 * lose ten unrelated proofs over it.
 */
export function readProgress(value: unknown): ProgressReading {
  const empty = { progress: emptyProgress(), discarded: [] };
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return empty;

  const stored = value as Record<string, unknown>;
  if (stored.format !== PROGRESS_FORMAT) return empty;
  if (stored.version !== PROGRESS_VERSION) return empty;
  if (typeof stored.best !== 'object' || stored.best === null || Array.isArray(stored.best)) {
    return empty;
  }

  const progress = emptyProgress();
  const discarded: string[] = [];

  for (const [id, entry] of Object.entries(stored.best as Record<string, unknown>).slice(
    0,
    MAX_ENTRIES,
  )) {
    const challenge = challengeById(id);
    if (!challenge) {
      discarded.push(id);
      continue;
    }
    const best = readBest(challenge, entry);
    if (best) progress.best[id] = best;
    else discarded.push(id);
  }

  return { progress, discarded };
}

/**
 * One entry, believed only as far as it replays.
 *
 * Three things have to agree: the record must rebuild into a proof of this
 * challenge — `importProofRecord` refuses one that starts elsewhere, aims
 * elsewhere, or used tools the challenge forbids — that proof must actually
 * reach the goal, and the step count stored beside it must be the one the
 * replay produces. The last of those is what stops a hand-edited `steps: 1`
 * from taking a personal best it did not earn.
 */
function readBest(challenge: Challenge, entry: unknown): Best | null {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return null;
  const stored = entry as Record<string, unknown>;

  let replayed: ProofState;
  try {
    replayed = importProofRecord(stored.record);
  } catch {
    return null;
  }

  if (replayed.challenge !== challenge.id) return null;
  if (!isComplete(replayed)) return null;
  if (stored.steps !== stepCount(replayed)) return null;

  return best(replayed);
}

function best(state: ProofState): Best {
  return { steps: stepCount(state), ruleset: [...state.ruleset], record: exportProof(state) };
}

/* ------------------------------------------------------------------ */
/* Writing                                                             */
/* ------------------------------------------------------------------ */

/**
 * Record a finished proof, if it is one and if it beats what is there.
 *
 * A shorter proof only displaces a longer one when both were built with the
 * same tools. Comparing across rulesets would produce a "best" that means
 * nothing — four steps with cancellation available is not the same achievement
 * as four steps without it — so a proof under different tools replaces the old
 * record outright rather than competing with it, and the ruleset it names goes
 * with it.
 */
export function recordProof(progress: Progress, state: ProofState): Progress {
  if (!isComplete(state)) return progress;
  if (!challengeById(state.challenge)) return progress;

  const candidate = best(state);
  const existing = progress.best[state.challenge];

  if (existing) {
    const comparable = sameRuleset(existing.ruleset, candidate.ruleset);
    if (comparable && existing.steps <= candidate.steps) return progress;
  }

  return { ...progress, best: { ...progress.best, [state.challenge]: candidate } };
}

function sameRuleset(left: AnyRuleId[], right: AnyRuleId[]): boolean {
  return left.length === right.length && left.every((rule) => right.includes(rule));
}

/* ------------------------------------------------------------------ */
/* What it means                                                       */
/* ------------------------------------------------------------------ */

export function isChallengeComplete(progress: Progress, id: string): boolean {
  return progress.best[id] !== undefined;
}

export function bestFor(progress: Progress, id: string): Best | undefined {
  return progress.best[id];
}

/**
 * Whether the menu offers this challenge.
 *
 * The first is always open; every other one waits on the challenge before it.
 * This gates the *menu* — a direct link opens a challenge whatever this says,
 * because a link is an explicit act by somebody who meant it, and because every
 * challenge staying linkable is what the menu shell was built to guarantee.
 */
export function isUnlocked(progress: Progress, id: string): boolean {
  const challenge = challengeById(id);
  if (!challenge) return true;
  if (!challenge.requires) return true;
  return isChallengeComplete(progress, challenge.requires);
}

/** The first challenge not yet finished: where "continue" goes. */
export function nextChallenge(progress: Progress): Challenge | undefined {
  return CHALLENGES.find((challenge) => !isChallengeComplete(progress, challenge.id));
}

/**
 * Where a click on a locked course entry should lead.
 *
 * Deep links may intentionally jump ahead, but a control inside the course must
 * not manufacture such a jump. Walking from the beginning finds the earliest
 * unfinished prerequisite, which is the next useful place in a linear course.
 */
export function requiredChallenge(progress: Progress, id: string): Challenge | undefined {
  const target = CHALLENGES.findIndex((challenge) => challenge.id === id);
  if (target === -1) return undefined;
  return CHALLENGES.slice(0, target + 1).find(
    (challenge) => !isChallengeComplete(progress, challenge.id),
  );
}

/** Every law proved so far, in the order the curriculum earns them. */
export function earnedRules(progress: Progress): AnyRuleId[] {
  return CHALLENGES.filter((challenge) => isChallengeComplete(progress, challenge.id)).flatMap(
    (challenge) => challenge.grants ?? [],
  );
}

export type Standing = 'unproved' | 'proved' | 'matched' | 'beaten';

/**
 * How a personal best reads against the proof the challenge ships with.
 *
 * The two are separate concepts and stay separate: the benchmark is a proof
 * somebody wrote down, not a claim that nothing shorter exists, so beating it
 * is "shorter than the one we know" and never "shortest possible".
 */
export function standing(progress: Progress, challenge: Challenge): Standing {
  const record = progress.best[challenge.id];
  if (!record) return 'unproved';
  const benchmark = benchmarkSteps(challenge);
  if (record.steps < benchmark) return 'beaten';
  return record.steps === benchmark ? 'matched' : 'proved';
}

export function completedCount(progress: Progress): number {
  return CHALLENGES.filter((challenge) => isChallengeComplete(progress, challenge.id)).length;
}

/* ------------------------------------------------------------------ */
/* Carrying it elsewhere                                               */
/* ------------------------------------------------------------------ */

export function progressToJson(progress: Progress): string {
  return `${JSON.stringify(progress, null, 2)}\n`;
}

/** Read exported progress text. Throws only on text that is not JSON at all. */
export function progressFromJson(text: string): ProgressReading {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new TypeError('That is not valid JSON.');
  }
  return readProgress(parsed);
}
