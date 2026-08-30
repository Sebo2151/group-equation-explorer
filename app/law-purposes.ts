import type { AnyRuleId } from './catalogue.ts';

export type LawPurpose = {
  id: 'simplify' | 'introduce' | 'inverses' | 'powers' | 'equations';
  label: string;
  description: string;
  rules: AnyRuleId[];
};

/**
 * The law palette is organised by the job a learner is trying to do, not by
 * the file or axiom family the implementation happens to use.
 */
export const LAW_PURPOSES: LawPurpose[] = [
  {
    id: 'simplify',
    label: 'Simplification',
    description: 'Remove identity and inverse structure that is ready to collapse.',
    rules: ['cancel-inverse', 'remove-identity', 'double-inverse', 'inverse-of-identity'],
  },
  {
    id: 'introduce',
    label: 'Adding structure',
    description: 'Insert a reversible form that creates a useful next move.',
    rules: ['insert-inverse-pair', 'insert-identity', 'wrap-double-inverse'],
  },
  {
    id: 'inverses',
    label: 'Inverses and products',
    description: 'Rewrite an inverse of a product, or collect inverse factors.',
    rules: ['inverse-of-product', 'combine-inverses'],
  },
  {
    id: 'powers',
    label: 'Power properties',
    description: 'Move between exponent notation and the products it abbreviates.',
    rules: [
      'expand-power',
      'combine-repeats',
      'combine-powers',
      'zero-power',
      'inverse-of-power',
      'negative-power',
    ],
  },
  {
    id: 'equations',
    label: 'Equation transformations',
    description: 'Make an equivalent change to the equation as a whole.',
    rules: ['symmetry', 'left-multiply', 'right-multiply', 'invert-both-sides', 'cancel-left', 'cancel-right'],
  },
];

export function purposeFor(rule: AnyRuleId): LawPurpose {
  const purpose = LAW_PURPOSES.find((entry) => entry.rules.includes(rule));
  if (!purpose) throw new RangeError(`No purpose assigned to rule "${rule}".`);
  return purpose;
}
