/**
 * The whole-equation rule catalogue.
 *
 * These are the operations that act on a line as a whole rather than on a
 * sub-expression inside it. They are kept apart from `rules.ts` because they
 * have a genuinely different shape: a term rule enumerates the places it could
 * apply and rewrites one of them, while a whole-equation rule has no target at
 * all — there is nothing on the line for it to point at. Forcing both into one
 * table would mean a `targets()` that returns a single meaningless placeholder
 * for half the catalogue, and the "one control per candidate" invariant would
 * have to special-case it. The two tables are unioned for lookup in
 * `catalogue.ts`; nothing else needs to know there are two.
 *
 * Every rule here is a theorem of any group, in the direction it declares.
 */

import { equation, subjectSpeech, type Equation } from './subject.ts';
import { hostFactors, inverse, product, termSpeech, termsEqual, type Term } from './term.ts';
import type { RuleArgument } from './rules.ts';

export type EquationRuleId =
  | 'symmetry'
  | 'left-multiply'
  | 'right-multiply'
  | 'invert-both-sides'
  | 'cancel-left'
  | 'cancel-right';

/**
 * Whether the rule's converse also holds.
 *
 * `iff` means the line before and the line after are equivalent: the proof may
 * be read in either direction, and the chain is joined by `⟺`. `forward` means
 * only that the new line follows from the old one — squaring both sides is the
 * standard example, true forwards and false backwards.
 *
 * Every rule in this catalogue is `iff`, and Phase 3 asserts exactly that in a
 * test. The field exists anyway because Phase 6 is where one-way inference
 * arrives, and by then proof records will exist that would need migrating to
 * gain it. Carrying it from the start costs one field and no logic.
 *
 * Note that `iff` is a claim about truth in both directions, not a promise that
 * a single step undoes the move: recovering `u = v` from `wu = wv` takes a
 * multiplication and then some cancelling.
 */
export type Direction = 'iff' | 'forward';

export type EquationRuleDefinition = {
  id: EquationRuleId;
  name: string;
  family: 'equation';
  /** Short law name shown against a committed line. */
  reason: string;
  formula: string;
  /** Spoken rendering of `formula`; TeX must never reach an accessible name. */
  spokenFormula: string;
  description: string;
  direction: Direction;
  /** Needs a term from the learner before it can be applied. */
  needsTerm: boolean;
  /** What to ask for when `needsTerm`; the field label the learner reads. */
  termPrompt?: string;
};

type EquationRewrite = { subject: Equation; detail: string };

type EquationRuleImplementation = EquationRuleDefinition & {
  /** Whether this line admits the operation at all. */
  applies(subject: Equation): boolean;
  rewrite(subject: Equation, argument?: RuleArgument): EquationRewrite;
};

const EQUATION_RULE_TABLE: Record<EquationRuleId, EquationRuleImplementation> = {
  symmetry: {
    id: 'symmetry',
    name: 'Swap the sides',
    family: 'equation',
    reason: 'Symmetry',
    formula: 'u=v \\iff v=u',
    spokenFormula: 'u equals v if and only if v equals u',
    description: 'An equation reads the same in either direction.',
    direction: 'iff',
    needsTerm: false,
    applies() {
      return true;
    },
    rewrite(subject) {
      const swapped = equation(subject.right, subject.left);
      return {
        subject: swapped,
        detail: `the same equation read the other way round, ${subjectSpeech(swapped)}`,
      };
    },
  },

  /**
   * Left and right multiplication are separate rules rather than one rule with
   * a direction argument. The group is not assumed abelian, so `wu = wv` and
   * `uw = vw` are different statements; keeping them apart means a recorded
   * step, an exported reason and a spoken name each say which was used without
   * needing a flag read alongside them.
   *
   * The converse holds — cancel `w` by multiplying by its inverse — so these
   * are equivalences. Cancellation is not offered as a law of its own: it is
   * derivable from these, and proving it before using it is the point.
   */
  'left-multiply': {
    id: 'left-multiply',
    name: 'Multiply on the left',
    family: 'equation',
    reason: 'Left multiplication',
    formula: 'u=v \\iff wu=wv',
    spokenFormula: 'u equals v if and only if w times u equals w times v',
    description: 'Multiply both sides on the left by the same term.',
    direction: 'iff',
    needsTerm: true,
    termPrompt: 'Multiply by this term',
    applies() {
      return true;
    },
    rewrite(subject, argument) {
      const factor = argument!.term;
      return {
        subject: equation(
          product([factor, subject.left]),
          product([factor, subject.right]),
        ),
        detail: `multiplying both sides on the left by ${termSpeech(factor)}`,
      };
    },
  },

  'right-multiply': {
    id: 'right-multiply',
    name: 'Multiply on the right',
    family: 'equation',
    reason: 'Right multiplication',
    formula: 'u=v \\iff uw=vw',
    spokenFormula: 'u equals v if and only if u times w equals v times w',
    description: 'Multiply both sides on the right by the same term.',
    direction: 'iff',
    needsTerm: true,
    termPrompt: 'Multiply by this term',
    applies() {
      return true;
    },
    rewrite(subject, argument) {
      const factor = argument!.term;
      return {
        subject: equation(
          product([subject.left, factor]),
          product([subject.right, factor]),
        ),
        detail: `multiplying both sides on the right by ${termSpeech(factor)}`,
      };
    },
  },

  /**
   * Inversion is its own converse, since inverting twice returns the original
   * equation. Note that this reverses nothing on its own: turning `(ab)^{-1}`
   * into `b^{-1}a^{-1}` is socks-and-shoes, a separate law applied to one side
   * afterwards.
   */
  'invert-both-sides': {
    id: 'invert-both-sides',
    name: 'Invert both sides',
    family: 'equation',
    reason: 'Inverses of equals',
    formula: 'u=v \\iff u^{-1}=v^{-1}',
    spokenFormula: 'u equals v if and only if u inverse equals v inverse',
    description: 'Equal terms have equal inverses.',
    direction: 'iff',
    needsTerm: false,
    applies() {
      return true;
    },
    rewrite(subject) {
      return {
        subject: equation(inverse(subject.left), inverse(subject.right)),
        detail: 'inverting both sides',
      };
    },
  },

  /**
   * Cancellation. Not an axiom and not free: these two exist only because the
   * cancellation challenge derives them, and they are handed over there as the
   * reward for that derivation. Before it, they are not in anyone's ruleset.
   *
   * Left and right stay separate for the same reason multiplication does. The
   * group is not assumed abelian, so a shared factor at the front and a shared
   * factor at the back are different situations, and a recorded step should say
   * which one was used without a flag read alongside it.
   *
   * Stripping is by one factor, the outermost shared one, so `a b x = a b y`
   * takes two steps rather than silently collapsing. A side that is left with
   * nothing becomes the identity, which is correct: `a = a b` really does say
   * `e = b`.
   */
  'cancel-left': {
    id: 'cancel-left',
    name: 'Cancel on the left',
    family: 'equation',
    reason: 'Left cancellation',
    formula: 'wu=wv \\iff u=v',
    spokenFormula: 'w times u equals w times v if and only if u equals v',
    description: 'Drop a factor that both sides begin with.',
    direction: 'iff',
    needsTerm: false,
    applies(subject) {
      return sharedEnd(subject, 'front') !== null;
    },
    rewrite(subject) {
      const shared = sharedEnd(subject, 'front')!;
      return {
        subject: equation(
          product(hostFactors(subject.left).slice(1)),
          product(hostFactors(subject.right).slice(1)),
        ),
        detail: `cancelling the ${termSpeech(shared)} both sides begin with`,
      };
    },
  },

  'cancel-right': {
    id: 'cancel-right',
    name: 'Cancel on the right',
    family: 'equation',
    reason: 'Right cancellation',
    formula: 'uw=vw \\iff u=v',
    spokenFormula: 'u times w equals v times w if and only if u equals v',
    description: 'Drop a factor that both sides end with.',
    direction: 'iff',
    needsTerm: false,
    applies(subject) {
      return sharedEnd(subject, 'back') !== null;
    },
    rewrite(subject) {
      const shared = sharedEnd(subject, 'back')!;
      return {
        subject: equation(
          product(hostFactors(subject.left).slice(0, -1)),
          product(hostFactors(subject.right).slice(0, -1)),
        ),
        detail: `cancelling the ${termSpeech(shared)} both sides end with`,
      };
    },
  },
};

/**
 * The factor both sides start or end with, or `null` when they do not agree
 * there. Both sides must have one to give up: `x = x` cancels to `e = e`, which
 * is true and reversible, but a side with no factors at all cannot.
 */
function sharedEnd(subject: Equation, which: 'front' | 'back'): Term | null {
  const left = hostFactors(subject.left);
  const right = hostFactors(subject.right);
  if (left.length === 0 || right.length === 0) return null;

  const pick = (factors: Term[]) => (which === 'front' ? factors[0] : factors[factors.length - 1]);
  const candidate = pick(left);
  return termsEqual(candidate, pick(right)) ? candidate : null;
}

export const EQUATION_RULES: EquationRuleDefinition[] = Object.values(EQUATION_RULE_TABLE).map(
  (rule) => ({
    id: rule.id,
    name: rule.name,
    family: rule.family,
    reason: rule.reason,
    formula: rule.formula,
    spokenFormula: rule.spokenFormula,
    description: rule.description,
    direction: rule.direction,
    needsTerm: rule.needsTerm,
    ...(rule.termPrompt ? { termPrompt: rule.termPrompt } : {}),
  }),
);

export const EQUATION_RULE_IDS: EquationRuleId[] = EQUATION_RULES.map((rule) => rule.id);

const EQUATION_DEFINITIONS = new Map<EquationRuleId, EquationRuleDefinition>(
  EQUATION_RULES.map((rule) => [rule.id, rule]),
);

export function isEquationRuleId(value: unknown): value is EquationRuleId {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(EQUATION_RULE_TABLE, value)
  );
}

export function equationRuleById(id: EquationRuleId): EquationRuleDefinition {
  const definition = EQUATION_DEFINITIONS.get(id);
  if (!definition) throw new RangeError(`Unknown equation rule "${String(id)}".`);
  return definition;
}

function equationRuleImplementation(id: EquationRuleId): EquationRuleImplementation {
  const implementation = Object.prototype.hasOwnProperty.call(EQUATION_RULE_TABLE, id)
    ? EQUATION_RULE_TABLE[id]
    : undefined;
  if (!implementation) throw new RangeError(`Unknown equation rule "${String(id)}".`);
  return implementation;
}

/** Whether the operation is offered on this line. */
export function equationRuleApplies(subject: Equation, id: EquationRuleId): boolean {
  return equationRuleImplementation(id).applies(subject);
}

/**
 * Apply one whole-equation operation. The caller is responsible for the size
 * budget, which is checked once in `catalogue.ts` for both kinds of rule.
 */
export function applyEquationRule(
  subject: Equation,
  id: EquationRuleId,
  argument?: RuleArgument,
): EquationRewrite {
  const implementation = equationRuleImplementation(id);
  if (!implementation.applies(subject)) {
    throw new RangeError(`Rule ${id} does not apply to this equation.`);
  }
  return implementation.rewrite(subject, argument);
}
