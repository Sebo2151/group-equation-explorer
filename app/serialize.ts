/**
 * Export and import.
 *
 * A stored proof is not trusted. Import parses the start term, validates the
 * ruleset, and replays every step through the same rule contracts the UI uses;
 * a record whose steps do not check out is rejected rather than displayed. Size
 * and step limits are applied before any of that work begins.
 */

import { challengeById, challengeSetup, freeSetup, type ChallengeSetup } from './challenges.ts';
import { parseTerm } from './parse.ts';
import {
  createProof,
  replayableSteps,
  replayProof,
  visibleLines,
  MAX_STEPS,
  type ProofState,
} from './proof.ts';
import { isRuleId, ruleById, type RuleArgument, type RuleId } from './rules.ts';
import { termsEqual, termSource, termTex, type Path, type Term } from './term.ts';

export const PROOF_FORMAT = 'group-equation-explorer/proof';
export const PROOF_VERSION = 1;

/** Bounds the parsing work an untrusted record can cause. */
export const MAX_IMPORT_CHARACTERS = 20_000;

/** Longer than this and a link stops being usable; export the JSON instead. */
export const MAX_HASH_CHARACTERS = 1_800;

export type StepRecord = {
  rule: RuleId;
  path: number[];
  start: number;
  end: number;
  /** Source text of the instantiated term, for rules that need one. */
  term?: string;
  inverseFirst?: boolean;
};

export type ProofRecord = {
  format: string;
  version: number;
  challenge: string;
  start: string;
  goal: string | null;
  ruleset: RuleId[];
  steps: StepRecord[];
};

export function exportProof(state: ProofState): ProofRecord {
  return {
    format: PROOF_FORMAT,
    version: PROOF_VERSION,
    challenge: state.challenge,
    start: termSource(state.start),
    goal: state.goal === null ? null : termSource(state.goal),
    ruleset: [...state.ruleset],
    steps: replayableSteps(state).map(({ rule, target, argument }) => ({
      rule,
      path: [...target.path],
      start: target.start,
      end: target.end,
      ...(argument ? { term: termSource(argument.term) } : {}),
      ...(argument?.inverseFirst ? { inverseFirst: true } : {}),
    })),
  };
}

export function proofToJson(state: ProofState): string {
  return `${JSON.stringify(exportProof(state), null, 2)}\n`;
}

/**
 * Rebuild a proof from a record. Throws with a readable message on anything
 * malformed, oversized, inconsistent with the named challenge, or unreplayable.
 */
export function importProof(text: unknown): ProofState {
  if (typeof text !== 'string') throw new TypeError('Paste the exported proof text.');
  const trimmed = text.trim();
  if (trimmed.length === 0) throw new TypeError('Nothing to import.');
  if (trimmed.length > MAX_IMPORT_CHARACTERS) {
    throw new RangeError(`Proof text is longer than ${MAX_IMPORT_CHARACTERS} characters.`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new TypeError('That is not valid JSON.');
  }

  return replayRecord(validateRecord(parsed));
}

function validateRecord(value: unknown): ProofRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('A proof record must be a JSON object.');
  }
  const record = value as Record<string, unknown>;

  if (record.format !== PROOF_FORMAT) {
    throw new TypeError('That is not a Group Equation Explorer proof.');
  }
  if (record.version !== PROOF_VERSION) {
    throw new TypeError(`Unsupported proof version ${String(record.version)}.`);
  }
  if (typeof record.challenge !== 'string' || record.challenge.length > 64) {
    throw new TypeError('Proof record is missing a challenge id.');
  }
  if (typeof record.start !== 'string') {
    throw new TypeError('Proof record is missing its starting expression.');
  }
  if (record.goal !== null && typeof record.goal !== 'string') {
    throw new TypeError('Proof record has an unreadable goal.');
  }
  if (!Array.isArray(record.ruleset) || !record.ruleset.every(isRuleId)) {
    throw new TypeError('Proof record names a rule this version does not have.');
  }
  if (!Array.isArray(record.steps)) throw new TypeError('Proof record is missing its steps.');
  if (record.steps.length > MAX_STEPS) {
    throw new RangeError(`A proof may not exceed ${MAX_STEPS} steps.`);
  }

  return {
    format: PROOF_FORMAT,
    version: PROOF_VERSION,
    challenge: record.challenge,
    start: record.start,
    goal: record.goal as string | null,
    ruleset: record.ruleset as RuleId[],
    steps: record.steps.map(validateStepRecord),
  };
}

function validateStepRecord(value: unknown, index: number): StepRecord {
  const where = `Step ${index + 1}`;
  if (typeof value !== 'object' || value === null) throw new TypeError(`${where} is malformed.`);
  const step = value as Record<string, unknown>;

  if (!isRuleId(step.rule)) throw new TypeError(`${where} names an unknown rule.`);
  if (!Array.isArray(step.path) || !step.path.every((entry) => Number.isInteger(entry) && entry >= 0)) {
    throw new TypeError(`${where} has an unreadable target path.`);
  }
  if (!Number.isInteger(step.start) || !Number.isInteger(step.end)) {
    throw new TypeError(`${where} has an unreadable target span.`);
  }
  if (step.term !== undefined && typeof step.term !== 'string') {
    throw new TypeError(`${where} has an unreadable term.`);
  }
  if (step.inverseFirst !== undefined && typeof step.inverseFirst !== 'boolean') {
    throw new TypeError(`${where} has an unreadable order flag.`);
  }

  return {
    rule: step.rule,
    path: step.path as number[],
    start: step.start as number,
    end: step.end as number,
    ...(step.term === undefined ? {} : { term: step.term as string }),
    ...(step.inverseFirst ? { inverseFirst: true } : {}),
  };
}

function replayRecord(record: ProofRecord): ProofState {
  const start = parseTerm(record.start, 'starting expression');
  const goal = record.goal === null ? null : parseTerm(record.goal, 'goal');
  const setup = challengeSetupFor(record, start, goal);

  return replayProof(
    setup,
    record.steps.map((step) => ({
      rule: step.rule,
      target: { path: step.path as Path, start: step.start, end: step.end },
      ...(step.term === undefined
        ? {}
        : {
            argument: {
              term: parseTerm(step.term, `step term "${step.term}"`),
              ...(step.inverseFirst ? { inverseFirst: true } : {}),
            } satisfies RuleArgument,
          }),
    })),
  );
}

/**
 * A record that claims a known challenge must actually match it. Otherwise an
 * edited file could present a proof built with extra tools as a solution to a
 * challenge that forbids them — the plan's "imported proofs must be validated,
 * not trusted as unlock evidence".
 */
function challengeSetupFor(record: ProofRecord, start: Term, goal: Term | null): ChallengeSetup {
  const challenge = challengeById(record.challenge);
  if (!challenge) return { ...freeSetup(start, goal), challenge: record.challenge };

  const declared = challengeSetup(challenge);

  if (!termsEqual(start, declared.start)) {
    throw new RangeError(`Proof claims challenge ${challenge.id} but starts somewhere else.`);
  }
  if ((goal === null) !== (declared.goal === null) || (goal && declared.goal && !termsEqual(goal, declared.goal))) {
    throw new RangeError(`Proof claims challenge ${challenge.id} but aims somewhere else.`);
  }
  const extra = record.ruleset.filter((rule) => !challenge.rules.includes(rule));
  if (extra.length > 0) {
    throw new RangeError(
      `Proof claims challenge ${challenge.id} but uses tools it does not permit: ${extra.join(', ')}.`,
    );
  }

  return { challenge: challenge.id, start, goal, ruleset: record.ruleset };
}

/* ------------------------------------------------------------------ */
/* LaTeX                                                               */
/* ------------------------------------------------------------------ */

/**
 * Reasons and details are plain words by construction, but this is what goes
 * into a `\text{}` in someone else's document, so the safe set is enforced
 * rather than assumed.
 */
function latexText(text: string): string {
  return text.replace(/[^A-Za-z0-9 ,.:;'-]/g, ' ').trim();
}

export function proofToLatex(state: ProofState): string {
  const lines = visibleLines(state);
  const body = lines.map((line, index) => {
    const math = termTex(line.term);
    if (index === 0) return `  & ${math} \\\\`;
    const note = latexText(`${line.step!.reason}: ${line.step!.detail}`);
    return `  &= ${math} && \\text{${note}} \\\\`;
  });

  return ['\\begin{align*}', ...body, '\\end{align*}', ''].join('\n');
}

/* ------------------------------------------------------------------ */
/* Links                                                               */
/* ------------------------------------------------------------------ */

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(encoded: string): string {
  if (!/^[A-Za-z0-9_-]*$/.test(encoded)) throw new TypeError('That link is not readable.');
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
  try {
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    throw new TypeError('That link is not readable.');
  }
}

/**
 * A shareable fragment, or `null` when the proof is too long to travel in a
 * URL. Silently truncating a proof would be worse than saying so.
 */
export function proofToHash(state: ProofState): string | null {
  const encoded = toBase64Url(JSON.stringify(exportProof(state)));
  return encoded.length > MAX_HASH_CHARACTERS ? null : `#proof=${encoded}`;
}

export function proofFromHash(hash: string): ProofState | null {
  const match = /(?:^#?|&)proof=([A-Za-z0-9_-]+)/.exec(hash);
  if (!match) return null;
  if (match[1].length > MAX_HASH_CHARACTERS) {
    throw new RangeError('That link carries more than this app will read.');
  }
  return importProof(fromBase64Url(match[1]));
}

/** A fresh proof of the same shape, for the Restart control after an import. */
export function reopen(state: ProofState): ProofState {
  return createProof(state);
}

export function rulesetNames(ruleset: RuleId[]): string[] {
  return ruleset.map((id) => ruleById(id).name);
}
