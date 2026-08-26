export type Factor = {
  base: string;
  inverse?: boolean;
  identity?: boolean;
};

export type RuleId = 'inverse' | 'identity';

export type RuleDefinition = {
  id: RuleId;
  name: string;
  formula: string;
  description: string;
};

export type Transformation = {
  factors: Factor[];
  reason: string;
  detail: string;
};

export const START: Factor[] = [
  { base: 'a' },
  { base: 'a', inverse: true },
  { base: 'b' },
  { base: 'c', inverse: true },
  { base: 'c' },
];

export const RULES: RuleDefinition[] = [
  {
    id: 'inverse',
    name: 'Cancel inverse pair',
    formula: 'xx^{-1}=e=x^{-1}x',
    description: 'Replace adjacent inverse factors by the identity.',
  },
  {
    id: 'identity',
    name: 'Remove identity',
    formula: 'ex=x=xe',
    description: 'Remove an identity factor from a product.',
  },
];

export function cloneFactors(factors: Factor[]) {
  return factors.map((factor) => ({ ...factor }));
}

export function factorTex(factor: Factor) {
  if (factor.identity) return 'e';
  return factor.inverse ? `${factor.base}^{-1}` : factor.base;
}

export function expressionTex(factors: Factor[]) {
  return factors.length ? factors.map(factorTex).join('') : 'e';
}

function sameBase(left: Factor, right: Factor) {
  return !left.identity && !right.identity && left.base === right.base;
}

export function findCandidates(factors: Factor[], rule: RuleId) {
  if (rule === 'identity') {
    return factors.flatMap((factor, index) => (factor.identity ? [index] : []));
  }

  return factors.flatMap((factor, index) => {
    const next = factors[index + 1];
    return next && sameBase(factor, next) && Boolean(factor.inverse) !== Boolean(next.inverse)
      ? [index]
      : [];
  });
}

export function applyTransformation(factors: Factor[], rule: RuleId, index: number): Transformation {
  if (!findCandidates(factors, rule).includes(index)) {
    throw new Error(`Rule ${rule} is not valid at factor ${index}.`);
  }

  const next = cloneFactors(factors);
  if (rule === 'inverse') {
    const cancelled = `${factorTex(next[index])}${factorTex(next[index + 1])}`;
    next.splice(index, 2, { base: 'e', identity: true });
    return {
      factors: next,
      reason: 'Inverse law',
      detail: `${cancelled} is the identity`,
    };
  }

  next.splice(index, 1);
  return {
    factors: next,
    reason: 'Identity law',
    detail: 'Removing e does not change the product',
  };
}
