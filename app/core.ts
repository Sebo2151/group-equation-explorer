export type Factor = {
  base: string;
  inverse?: boolean;
  identity?: boolean;
};

export type RuleId = 'inverse' | 'identity';

/** A contiguous span of factors, `start` and `end` both inclusive. */
export type Target = { start: number; end: number };

export type RuleDefinition = {
  id: RuleId;
  name: string;
  formula: string;
  /** Spoken rendering of `formula`; TeX must never reach an accessible name. */
  spokenFormula: string;
  description: string;
};

export type Transformation = {
  factors: Factor[];
  rule: RuleId;
  target: Target;
  reason: string;
  detail: string;
};

/**
 * Generators are a single letter, optionally followed by digits: `a`, `x`, `r2`.
 * Everything reaching `factorTex` is interpolated into TeX, so the accepted
 * alphabet is deliberately narrow rather than escaped after the fact.
 */
const BASE_PATTERN = /^[A-Za-z][0-9]*$/;

export const START: Factor[] = [
  { base: 'a' },
  { base: 'a', inverse: true },
  { base: 'b' },
  { base: 'c', inverse: true },
  { base: 'c' },
];

export function cloneFactors(factors: Factor[]) {
  return factors.map((factor) => ({ ...factor }));
}

export function isRuleId(value: unknown): value is RuleId {
  return value === 'inverse' || value === 'identity';
}

/**
 * Reject malformed factors before they reach the renderer or a rule.
 * `identity` is exclusive: an identity factor carries no base and no inverse.
 */
export function validateFactor(factor: unknown, where = 'factor'): Factor {
  if (typeof factor !== 'object' || factor === null) {
    throw new TypeError(`${where}: expected an object, received ${typeof factor}.`);
  }

  const { base, inverse, identity } = factor as Record<string, unknown>;

  if (typeof base !== 'string') {
    throw new TypeError(`${where}: base must be a string.`);
  }
  if (inverse !== undefined && typeof inverse !== 'boolean') {
    throw new TypeError(`${where}: inverse must be a boolean when present.`);
  }
  if (identity !== undefined && typeof identity !== 'boolean') {
    throw new TypeError(`${where}: identity must be a boolean when present.`);
  }

  if (identity) {
    if (inverse) {
      throw new TypeError(`${where}: an identity factor cannot also be an inverse.`);
    }
    if (base !== 'e') {
      throw new TypeError(`${where}: an identity factor must use the base "e", received "${base}".`);
    }
    return { base: 'e', identity: true };
  }

  if (base === 'e') {
    // Reserved so that a rendered `e` always means the identity. Without this a
    // generator named `e` is indistinguishable on screen from the identity but
    // is not matched by the identity rule.
    throw new TypeError(`${where}: "e" is reserved for the identity and cannot name a generator.`);
  }
  if (!BASE_PATTERN.test(base)) {
    throw new TypeError(`${where}: "${base}" is not a valid generator name.`);
  }

  return inverse ? { base, inverse: true } : { base };
}

export function validateFactors(factors: unknown, where = 'expression'): Factor[] {
  if (!Array.isArray(factors)) {
    throw new TypeError(`${where}: expected an array of factors.`);
  }
  return factors.map((factor, index) => validateFactor(factor, `${where}[${index}]`));
}

export function factorTex(factor: Factor) {
  if (factor.identity) return 'e';
  return factor.inverse ? `${factor.base}^{-1}` : factor.base;
}

export function expressionTex(factors: Factor[]) {
  return factors.length ? factors.map(factorTex).join('') : 'e';
}

/** Screen-reader form. TeX source must never reach an accessible name. */
export function factorSpeech(factor: Factor) {
  if (factor.identity) return 'identity e';
  return factor.inverse ? `${factor.base} inverse` : factor.base;
}

export function expressionSpeech(factors: Factor[]) {
  return factors.length ? factors.map(factorSpeech).join(', ') : 'identity e';
}

export function spanSpeech(factors: Factor[], target: Target) {
  return factors.slice(target.start, target.end + 1).map(factorSpeech).join(', ');
}

function sameBase(left: Factor, right: Factor) {
  return !left.identity && !right.identity && left.base === right.base;
}

function isIndex(value: number, length: number) {
  return Number.isInteger(value) && value >= 0 && value < length;
}

type RuleImplementation = RuleDefinition & {
  targets(factors: Factor[]): Target[];
  rewrite(factors: Factor[], target: Target): Omit<Transformation, 'rule' | 'target'>;
};

/**
 * Matching and rewriting are defined together, per rule. Keeping the two halves
 * in one entry is what makes an unknown or half-implemented rule a lookup
 * failure instead of a silent fallthrough into some other rule's behaviour.
 */
const RULE_TABLE: Record<RuleId, RuleImplementation> = {
  inverse: {
    id: 'inverse',
    name: 'Cancel inverse pair',
    formula: 'xx^{-1}=e=x^{-1}x',
    spokenFormula: 'x times x inverse equals the identity equals x inverse times x',
    description: 'Replace adjacent inverse factors by the identity.',
    targets(factors) {
      return factors.flatMap((factor, index) => {
        const next = factors[index + 1];
        return next && sameBase(factor, next) && Boolean(factor.inverse) !== Boolean(next.inverse)
          ? [{ start: index, end: index + 1 }]
          : [];
      });
    },
    rewrite(factors, target) {
      const next = cloneFactors(factors);
      // Plain words, not TeX: this string is read aloud as well as displayed.
      const cancelled = `${factorSpeech(next[target.start])} times ${factorSpeech(next[target.start + 1])}`;
      next.splice(target.start, 2, { base: 'e', identity: true });
      return {
        factors: next,
        reason: 'Inverse law',
        detail: `${cancelled} is the identity`,
      };
    },
  },
  identity: {
    id: 'identity',
    name: 'Remove identity',
    formula: 'ex=x=xe',
    spokenFormula: 'the identity times x equals x equals x times the identity',
    description: 'Remove an identity factor from a product.',
    targets(factors) {
      // A lone identity is the whole product; removing it leaves the empty
      // product, which renders as `e` too. That step would consume a move and
      // change nothing the reader can see, so it is not offered.
      if (factors.length <= 1) return [];
      return factors.flatMap((factor, index) =>
        factor.identity ? [{ start: index, end: index }] : [],
      );
    },
    rewrite(factors, target) {
      const next = cloneFactors(factors);
      next.splice(target.start, 1);
      return {
        factors: next,
        reason: 'Identity law',
        detail: 'Removing e does not change the product',
      };
    },
  },
};

export const RULES: RuleDefinition[] = Object.values(RULE_TABLE).map(
  ({ id, name, formula, spokenFormula, description }) => ({
    id,
    name,
    formula,
    spokenFormula,
    description,
  }),
);

function ruleImplementation(rule: RuleId): RuleImplementation {
  const implementation = RULE_TABLE[rule];
  if (!implementation) {
    throw new RangeError(`Unknown rule "${String(rule)}".`);
  }
  return implementation;
}

export function findTargets(factors: Factor[], rule: RuleId): Target[] {
  return ruleImplementation(rule).targets(factors);
}

export function sameTarget(left: Target, right: Target) {
  return left.start === right.start && left.end === right.end;
}

export function targetContains(target: Target, index: number) {
  return index >= target.start && index <= target.end;
}

/**
 * Distribute targets into rows so that no row contains two overlapping spans.
 * Overlapping candidates (the two pairs in `a a^-1 a`) then get separate,
 * separately clickable controls instead of collapsing onto a shared factor.
 */
export function layerTargets(targets: Target[]): Target[][] {
  const rows: Target[][] = [];

  for (const target of [...targets].sort((left, right) => left.start - right.start)) {
    const row = rows.find((candidates) => {
      const last = candidates[candidates.length - 1];
      return last.end < target.start;
    });

    if (row) row.push(target);
    else rows.push([target]);
  }

  return rows;
}

export function applyTransformation(
  factors: Factor[],
  rule: RuleId,
  target: Target,
): Transformation {
  const implementation = ruleImplementation(rule);

  if (
    typeof target !== 'object' ||
    target === null ||
    !isIndex(target.start, factors.length) ||
    !isIndex(target.end, factors.length) ||
    target.end < target.start
  ) {
    throw new RangeError(`Rule ${rule} received an out-of-range target.`);
  }

  if (!implementation.targets(factors).some((candidate) => sameTarget(candidate, target))) {
    throw new RangeError(`Rule ${rule} is not valid at factors ${target.start}..${target.end}.`);
  }

  return { ...implementation.rewrite(factors, target), rule, target };
}
