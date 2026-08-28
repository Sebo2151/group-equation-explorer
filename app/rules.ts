/**
 * The rule catalogue.
 *
 * Matching and rewriting are defined together, one entry per rule, so an
 * unknown or half-implemented rule is a lookup failure rather than a silent
 * fallthrough into some other rule's behaviour. `RULES` is derived from the
 * table, so an advertised rule cannot exist without an implementation.
 *
 * Every rule here is a theorem of group theory, valid in any group. That is
 * separate from whether a *challenge* may use it: a challenge whose point is to
 * establish socks-and-shoes must not list `inverse-of-product` among its tools.
 * That gating lives with the challenge and its recorded ruleset, not here.
 */

import {
  getNode,
  hostFactors,
  hosts,
  identity,
  inverse,
  isGap,
  isInversePair,
  MAX_EXPONENT,
  MAX_NODES,
  nodeCount,
  power,
  product,
  replaceSpan,
  sameTarget,
  spanSpeech,
  spanTerms,
  termDepth,
  MAX_DEPTH,
  termsEqual,
  termSpeech,
  validateTerm,
  type Path,
  type Target,
  type Term,
} from './term.ts';

export type RuleId =
  | 'cancel-inverse'
  | 'insert-inverse-pair'
  | 'remove-identity'
  | 'insert-identity'
  | 'double-inverse'
  | 'wrap-double-inverse'
  | 'inverse-of-product'
  | 'combine-inverses'
  | 'inverse-of-identity'
  | 'expand-power'
  | 'combine-powers'
  | 'zero-power'
  | 'inverse-of-power'
  | 'negative-power';

export type RuleFamily = 'identity' | 'inverse' | 'power';

/**
 * What the learner supplies for a rule that cannot enumerate its own
 * instantiations. Inserting `xx^{-1}` has infinitely many readings, so the term
 * is asked for rather than guessed.
 */
export type RuleArgument = {
  term: Term;
  /** Insert `x^{-1}x` rather than `xx^{-1}`. */
  inverseFirst?: boolean;
};

export type RuleDefinition = {
  id: RuleId;
  name: string;
  family: RuleFamily;
  /** Short law name shown against a committed line. */
  reason: string;
  formula: string;
  /** Spoken rendering of `formula`; TeX must never reach an accessible name. */
  spokenFormula: string;
  description: string;
  /** Marks the gaps between factors rather than the factors themselves. */
  attachesToGaps: boolean;
  /** Needs a term from the learner before it can be applied. */
  needsTerm: boolean;
};

export type Transformation = {
  term: Term;
  rule: RuleId;
  target: Target;
  argument?: RuleArgument;
  reason: string;
  detail: string;
};

type Rewrite = { term: Term; detail: string };

type RuleImplementation = RuleDefinition & {
  targets(root: Term): Target[];
  rewrite(root: Term, target: Target, argument?: RuleArgument): Rewrite;
};

/* ------------------------------------------------------------------ */
/* Target enumeration helpers                                          */
/* ------------------------------------------------------------------ */

/** Every single factor, anywhere in the term, that satisfies `predicate`. */
function factorTargets(root: Term, predicate: (factor: Term, host: Term[]) => boolean): Target[] {
  return hosts(root).flatMap(({ path, factors }) =>
    factors.flatMap((factor, index) =>
      predicate(factor, factors) ? [{ path, start: index, end: index }] : [],
    ),
  );
}

/** Every contiguous span of at least `minimum` factors satisfying `predicate`. */
function spanTargets(
  root: Term,
  minimum: number,
  predicate: (span: Term[]) => boolean,
): Target[] {
  const found: Target[] = [];
  for (const { path, factors } of hosts(root)) {
    for (let start = 0; start < factors.length; start += 1) {
      for (let end = start + minimum - 1; end < factors.length; end += 1) {
        const span = factors.slice(start, end + 1);
        if (predicate(span)) found.push({ path, start, end });
      }
    }
  }
  return found;
}

/** Every position a factor could be inserted at, including both ends. */
function gapTargets(root: Term): Target[] {
  return hosts(root).flatMap(({ path, factors }) =>
    Array.from({ length: factors.length + 1 }, (_, index) => ({
      path,
      start: index,
      end: index - 1,
    })),
  );
}

/**
 * Whether a rewrite stays inside the structural budget. Expanding `a^{64}`
 * inside an already-large term would otherwise build something the renderer
 * and the validator would both reject after the fact.
 */
function withinBudget(term: Term): boolean {
  return nodeCount(term) <= MAX_NODES && termDepth(term) <= MAX_DEPTH;
}

/** The (base, exponent) a factor represents, for the power laws. */
function asPower(factor: Term): { base: Term; exponent: number } {
  if (factor.kind === 'power') return { base: factor.base, exponent: factor.exponent };
  if (factor.kind === 'inverse') return { base: factor.term, exponent: -1 };
  return { base: factor, exponent: 1 };
}

function replacement(root: Term, target: Target, terms: Term[]): Term {
  return replaceSpan(root, target, terms);
}

function repeated(term: Term, count: number): Term[] {
  return Array.from({ length: count }, () => term);
}

/* ------------------------------------------------------------------ */
/* The catalogue                                                       */
/* ------------------------------------------------------------------ */

const RULE_TABLE: Record<RuleId, RuleImplementation> = {
  'cancel-inverse': {
    id: 'cancel-inverse',
    name: 'Cancel inverse pair',
    family: 'inverse',
    reason: 'Inverse law',
    formula: 'xx^{-1}=e=x^{-1}x',
    spokenFormula: 'x times x inverse equals the identity equals x inverse times x',
    description: 'Replace two adjacent factors that are inverses of each other by the identity.',
    attachesToGaps: false,
    needsTerm: false,
    targets(root) {
      return spanTargets(root, 2, (span) => span.length === 2 && isInversePair(span[0], span[1]));
    },
    rewrite(root, target) {
      const [left, right] = spanTerms(root, target);
      return {
        term: replacement(root, target, [identity()]),
        detail: `${termSpeech(left)} times ${termSpeech(right)} is the identity`,
      };
    },
  },

  'insert-inverse-pair': {
    id: 'insert-inverse-pair',
    name: 'Insert inverse pair',
    family: 'inverse',
    reason: 'Inverse law',
    formula: 'x=xyy^{-1}',
    spokenFormula: 'x equals x times y times y inverse',
    description:
      'Insert a term next to its own inverse. There are infinitely many choices, so the term is yours to name.',
    attachesToGaps: true,
    needsTerm: true,
    targets: gapTargets,
    rewrite(root, target, argument) {
      const term = requireTerm(argument, 'insert-inverse-pair');
      const pair = argument?.inverseFirst ? [inverse(term), term] : [term, inverse(term)];
      return {
        term: replacement(root, target, pair),
        detail: argument?.inverseFirst
          ? `${termSpeech(term)} inverse times ${termSpeech(term)} is the identity`
          : `${termSpeech(term)} times ${termSpeech(term)} inverse is the identity`,
      };
    },
  },

  'remove-identity': {
    id: 'remove-identity',
    name: 'Remove identity',
    family: 'identity',
    reason: 'Identity law',
    formula: 'ex=x=xe',
    spokenFormula: 'the identity times x equals x equals x times the identity',
    description: 'Remove an identity factor from a product.',
    attachesToGaps: false,
    needsTerm: false,
    targets(root) {
      // A lone identity is the whole host: removing it leaves the empty
      // product, which is the identity again. That step would consume a move
      // and change nothing the reader can see, so it is not offered.
      return factorTargets(root, (factor, host) => factor.kind === 'identity' && host.length > 1);
    },
    rewrite(root, target) {
      return {
        term: replacement(root, target, []),
        detail: 'removing the identity does not change the product',
      };
    },
  },

  'insert-identity': {
    id: 'insert-identity',
    name: 'Insert identity',
    family: 'identity',
    reason: 'Identity law',
    formula: 'x=ex=xe',
    spokenFormula: 'x equals the identity times x equals x times the identity',
    description: 'Insert an identity factor anywhere in a product.',
    attachesToGaps: true,
    needsTerm: false,
    targets: gapTargets,
    rewrite(root, target) {
      return {
        term: replacement(root, target, [identity()]),
        detail: 'inserting the identity does not change the product',
      };
    },
  },

  'double-inverse': {
    id: 'double-inverse',
    name: 'Undo a double inverse',
    family: 'inverse',
    reason: 'Double inverse',
    formula: '\\left(x^{-1}\\right)^{-1}=x',
    spokenFormula: 'the inverse of x inverse equals x',
    description: 'The inverse of an inverse is the original term.',
    attachesToGaps: false,
    needsTerm: false,
    targets(root) {
      return factorTargets(
        root,
        (factor) => factor.kind === 'inverse' && factor.term.kind === 'inverse',
      );
    },
    rewrite(root, target) {
      const [factor] = spanTerms(root, target);
      const inner = (factor as { term: { kind: 'inverse'; term: Term } }).term.term;
      return {
        term: replacement(root, target, [inner]),
        detail: `the inverse of ${termSpeech(inner)} inverse is ${termSpeech(inner)}`,
      };
    },
  },

  'wrap-double-inverse': {
    id: 'wrap-double-inverse',
    name: 'Write as a double inverse',
    family: 'inverse',
    reason: 'Double inverse',
    formula: 'x=\\left(x^{-1}\\right)^{-1}',
    spokenFormula: 'x equals the inverse of x inverse',
    description: 'Rewrite a term as the inverse of its own inverse.',
    attachesToGaps: false,
    needsTerm: false,
    targets(root) {
      return factorTargets(root, () => true).filter((target) =>
        withinBudget(rewriteWrapDouble(root, target)),
      );
    },
    rewrite(root, target) {
      const [factor] = spanTerms(root, target);
      return {
        term: rewriteWrapDouble(root, target),
        detail: `${termSpeech(factor)} is the inverse of its own inverse`,
      };
    },
  },

  'inverse-of-product': {
    id: 'inverse-of-product',
    name: 'Distribute an inverse',
    family: 'inverse',
    reason: 'Socks and shoes',
    formula: '(xy)^{-1}=y^{-1}x^{-1}',
    spokenFormula: 'the inverse of x times y equals y inverse times x inverse',
    description: 'The inverse of a product is the product of the inverses, in reverse order.',
    attachesToGaps: false,
    needsTerm: false,
    targets(root) {
      return factorTargets(
        root,
        (factor) => factor.kind === 'inverse' && factor.term.kind === 'product',
      );
    },
    rewrite(root, target) {
      const [factor] = spanTerms(root, target);
      const inner = (factor as { term: { kind: 'product'; factors: Term[] } }).term.factors;
      const reversed = [...inner].reverse().map(inverse);
      return {
        term: replacement(root, target, reversed),
        detail: `the inverse of ${spanSpeech(inner)} is the inverses in reverse order`,
      };
    },
  },

  'combine-inverses': {
    id: 'combine-inverses',
    name: 'Collect into one inverse',
    family: 'inverse',
    reason: 'Socks and shoes',
    formula: 'y^{-1}x^{-1}=(xy)^{-1}',
    spokenFormula: 'y inverse times x inverse equals the inverse of x times y',
    description:
      'Adjacent inverses become the inverse of one product, with the order reversed.',
    attachesToGaps: false,
    needsTerm: false,
    targets(root) {
      return spanTargets(root, 2, (span) => span.every((factor) => factor.kind === 'inverse'));
    },
    rewrite(root, target) {
      const span = spanTerms(root, target);
      const inner = [...span].reverse().map((factor) => (factor as { term: Term }).term);
      return {
        term: replacement(root, target, [inverse(product(inner))]),
        detail: `${spanSpeech(span)} is the inverse of ${spanSpeech(inner)}`,
      };
    },
  },

  'inverse-of-identity': {
    id: 'inverse-of-identity',
    name: 'Invert the identity',
    family: 'identity',
    reason: 'Identity law',
    formula: 'e^{-1}=e',
    spokenFormula: 'the inverse of the identity equals the identity',
    description: 'The identity is its own inverse.',
    attachesToGaps: false,
    needsTerm: false,
    targets(root) {
      return factorTargets(
        root,
        (factor) => factor.kind === 'inverse' && factor.term.kind === 'identity',
      );
    },
    rewrite(root, target) {
      return {
        term: replacement(root, target, [identity()]),
        detail: 'the identity is its own inverse',
      };
    },
  },

  'expand-power': {
    id: 'expand-power',
    name: 'Write a power out',
    family: 'power',
    reason: 'Power notation',
    formula: 'x^{n}=\\underbrace{x\\cdots x}_{n}',
    spokenFormula: 'x to the power n equals x written n times',
    description: 'Replace a power by the repeated product it abbreviates.',
    attachesToGaps: false,
    needsTerm: false,
    targets(root) {
      return factorTargets(
        root,
        (factor) => factor.kind === 'power' && Math.abs(factor.exponent) >= 2,
      ).filter((target) => withinBudget(rewriteExpandPower(root, target)));
    },
    rewrite(root, target) {
      const [factor] = spanTerms(root, target);
      const { base, exponent } = factor as { base: Term; exponent: number };
      return {
        term: rewriteExpandPower(root, target),
        detail:
          exponent > 0
            ? `${termSpeech(base)} to the power ${exponent} is ${exponent} copies of ${termSpeech(base)}`
            : `${termSpeech(base)} to the power negative ${Math.abs(exponent)} is ${Math.abs(exponent)} copies of ${termSpeech(base)} inverse`,
      };
    },
  },

  'combine-powers': {
    id: 'combine-powers',
    name: 'Combine powers',
    family: 'power',
    reason: 'Power law',
    formula: 'x^{m}x^{n}=x^{m+n}',
    spokenFormula: 'x to the m times x to the n equals x to the m plus n',
    description: 'Adjacent powers of the same term add their exponents.',
    attachesToGaps: false,
    needsTerm: false,
    targets(root) {
      return spanTargets(root, 2, (span) => {
        if (span.some((factor) => factor.kind === 'identity')) return false;
        const parts = span.map(asPower);
        if (!parts.every((part) => termsEqual(part.base, parts[0].base))) return false;
        const total = parts.reduce((sum, part) => sum + part.exponent, 0);
        return Math.abs(total) <= MAX_EXPONENT;
      });
    },
    rewrite(root, target) {
      const span = spanTerms(root, target);
      const parts = span.map(asPower);
      const total = parts.reduce((sum, part) => sum + part.exponent, 0);
      return {
        term: replacement(root, target, [power(parts[0].base, total)]),
        detail: `the exponents ${parts.map((part) => exponentWords(part.exponent)).join(' and ')} add to ${exponentWords(total)}`,
      };
    },
  },

  'zero-power': {
    id: 'zero-power',
    name: 'Zero power is the identity',
    family: 'power',
    reason: 'Power law',
    formula: 'x^{0}=e',
    spokenFormula: 'x to the power 0 equals the identity',
    description: 'Any term to the power zero is the identity.',
    attachesToGaps: false,
    needsTerm: false,
    targets(root) {
      return factorTargets(root, (factor) => factor.kind === 'power' && factor.exponent === 0);
    },
    rewrite(root, target) {
      const [factor] = spanTerms(root, target);
      const { base } = factor as { base: Term };
      return {
        term: replacement(root, target, [identity()]),
        detail: `${termSpeech(base)} to the power 0 is the identity`,
      };
    },
  },

  'inverse-of-power': {
    id: 'inverse-of-power',
    name: 'Invert a power',
    family: 'power',
    reason: 'Power law',
    formula: '\\left(x^{n}\\right)^{-1}=x^{-n}',
    spokenFormula: 'the inverse of x to the n equals x to the negative n',
    description: 'Inverting a power negates its exponent.',
    attachesToGaps: false,
    needsTerm: false,
    targets(root) {
      return factorTargets(
        root,
        (factor) => factor.kind === 'inverse' && factor.term.kind === 'power',
      );
    },
    rewrite(root, target) {
      const [factor] = spanTerms(root, target);
      const inner = (factor as { term: { base: Term; exponent: number } }).term;
      return {
        term: replacement(root, target, [power(inner.base, -inner.exponent)]),
        detail: `inverting a power turns the exponent ${exponentWords(inner.exponent)} into ${exponentWords(-inner.exponent)}`,
      };
    },
  },

  'negative-power': {
    id: 'negative-power',
    name: 'Split a negative power',
    family: 'power',
    reason: 'Power law',
    formula: 'x^{-n}=\\left(x^{n}\\right)^{-1}',
    spokenFormula: 'x to the negative n equals the inverse of x to the n',
    description: 'A negative power is the inverse of the positive power.',
    attachesToGaps: false,
    needsTerm: false,
    targets(root) {
      return factorTargets(root, (factor) => factor.kind === 'power' && factor.exponent <= -2);
    },
    rewrite(root, target) {
      const [factor] = spanTerms(root, target);
      const { base, exponent } = factor as { base: Term; exponent: number };
      return {
        term: replacement(root, target, [inverse(power(base, -exponent))]),
        detail: `${termSpeech(base)} to the power ${exponentWords(exponent)} is the inverse of ${termSpeech(base)} to the power ${-exponent}`,
      };
    },
  },
};

function exponentWords(exponent: number): string {
  return exponent < 0 ? `negative ${Math.abs(exponent)}` : `${exponent}`;
}

function rewriteWrapDouble(root: Term, target: Target): Term {
  const [factor] = spanTerms(root, target);
  return replaceSpan(root, target, [inverse(inverse(factor))]);
}

function rewriteExpandPower(root: Term, target: Target): Term {
  const [factor] = spanTerms(root, target);
  const { base, exponent } = factor as { base: Term; exponent: number };
  const copies =
    exponent > 0 ? repeated(base, exponent) : repeated(inverse(base), Math.abs(exponent));
  return replaceSpan(root, target, copies);
}

function requireTerm(argument: RuleArgument | undefined, rule: string): Term {
  if (!argument) throw new RangeError(`Rule ${rule} needs a term.`);
  return validateTerm(argument.term, `${rule} term`);
}

/**
 * The argument arrives from the UI and from imported proofs alike.
 *
 * `rule` is only ever interpolated into the error message, so it is widened to
 * `string`: whole-equation rules use this too, and their ids are not `RuleId`s.
 */
export function validateArgument(argument: unknown, rule: string): RuleArgument {
  if (typeof argument !== 'object' || argument === null) {
    throw new RangeError(`Rule ${rule} needs a term.`);
  }
  const { inverseFirst } = argument as { inverseFirst?: unknown };
  if (inverseFirst !== undefined && typeof inverseFirst !== 'boolean') {
    throw new RangeError(`Rule ${rule}: order flag must be a boolean.`);
  }
  return {
    term: requireTerm(argument as RuleArgument, rule),
    ...(inverseFirst ? { inverseFirst: true } : {}),
  };
}

export const RULES: RuleDefinition[] = Object.values(RULE_TABLE).map((rule) => ({
  id: rule.id,
  name: rule.name,
  family: rule.family,
  reason: rule.reason,
  formula: rule.formula,
  spokenFormula: rule.spokenFormula,
  description: rule.description,
  attachesToGaps: rule.attachesToGaps,
  needsTerm: rule.needsTerm,
}));

export const RULE_IDS: RuleId[] = RULES.map((rule) => rule.id);

const DEFINITIONS = new Map<RuleId, RuleDefinition>(RULES.map((rule) => [rule.id, rule]));

export function isRuleId(value: unknown): value is RuleId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(RULE_TABLE, value);
}

/** The presentation half of a rule. Callers never need its implementation. */
export function ruleById(id: RuleId): RuleDefinition {
  const definition = DEFINITIONS.get(id);
  if (!definition) throw new RangeError(`Unknown rule "${String(id)}".`);
  return definition;
}

function ruleImplementation(id: RuleId): RuleImplementation {
  const implementation = Object.prototype.hasOwnProperty.call(RULE_TABLE, id)
    ? RULE_TABLE[id]
    : undefined;
  if (!implementation) throw new RangeError(`Unknown rule "${String(id)}".`);
  return implementation;
}

export function findTargets(root: Term, rule: RuleId): Target[] {
  return ruleImplementation(rule).targets(root);
}

/**
 * Validate a target against the term itself, before the rule sees it. This is
 * what an imported proof has to survive: a well-typed path can still address
 * nothing, and a well-typed span can still fall outside its host.
 */
function validateTargetShape(root: Term, target: unknown): Target {
  if (typeof target !== 'object' || target === null) {
    throw new RangeError('Target must be an object.');
  }
  const { path, start, end } = target as { path?: unknown; start?: unknown; end?: unknown };

  if (!Array.isArray(path) || !path.every((step) => Number.isInteger(step) && step >= 0)) {
    throw new RangeError('Target path must be a list of non-negative integers.');
  }
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    throw new RangeError('Target span must use integer bounds.');
  }

  const node = getNode(root, path as Path);
  const factors = hostFactors(node);
  const span = { path: path as Path, start: start as number, end: end as number };

  if (span.start < 0 || span.start > factors.length) throw new RangeError('Target span is out of range.');
  if (span.end < span.start - 1 || span.end >= factors.length) {
    throw new RangeError('Target span is out of range.');
  }

  return span;
}

/**
 * Apply one rule at one target. The rule must actually offer that target: a
 * span that merely looks plausible, or a gap offered to a rule that does not
 * attach to gaps, is rejected rather than rewritten.
 */
export function applyRule(
  root: Term,
  rule: RuleId,
  target: unknown,
  argument?: RuleArgument,
): Transformation {
  const implementation = ruleImplementation(rule);
  const span = validateTargetShape(root, target);

  if (implementation.attachesToGaps !== isGap(span)) {
    throw new RangeError(
      `Rule ${rule} applies ${implementation.attachesToGaps ? 'between factors' : 'to factors'}.`,
    );
  }

  if (!implementation.targets(root).some((candidate) => sameTarget(candidate, span))) {
    throw new RangeError(`Rule ${rule} does not apply there.`);
  }

  const checked = implementation.needsTerm ? validateArgument(argument, rule) : undefined;

  const { term, detail } = implementation.rewrite(root, span, checked);

  if (!withinBudget(term)) {
    throw new RangeError('That step would build an expression larger than the app supports.');
  }

  return {
    term,
    rule,
    target: span,
    ...(checked ? { argument: checked } : {}),
    reason: implementation.reason,
    detail,
  };
}
