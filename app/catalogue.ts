/**
 * The one catalogue the rest of the app sees.
 *
 * Term rules (`rules.ts`) and whole-equation rules (`equation-rules.ts`) have
 * different internal shapes, but everything above this line — the proof
 * reducer, the ruleset a challenge grants, an exported record, the law list in
 * the interface — wants a single id space and a single way to ask "where does
 * this apply, and what happens if I use it here?". Splitting that concern would
 * mean every caller carrying a scope test, and a challenge ruleset that could
 * not simply be a list of ids.
 *
 * The important consequence of the `Subject`/`Address` split lives here: a term
 * rule applied to one side of an equation is the *same* implementation that
 * Phase 2 already had, addressed differently. All fourteen term laws work in
 * equation mode without a line being added to `rules.ts`.
 */

import {
  EQUATION_RULES,
  applyEquationRule,
  equationRuleApplies,
  isEquationRuleId,
  type EquationRuleDefinition,
  type EquationRuleId,
} from './equation-rules.ts';
import {
  RULES,
  applyRule,
  findTargets,
  isRuleId,
  ruleById,
  validateArgument,
  type RuleArgument,
  type RuleDefinition,
  type RuleId,
} from './rules.ts';
import {
  SIDES,
  isEquation,
  replaceSide,
  sideTerm,
  subjectDepth,
  subjectNodeCount,
  type Address,
  type Side,
  type Subject,
} from './subject.ts';
import { MAX_DEPTH, MAX_NODES, type Target } from './term.ts';

export type AnyRuleId = RuleId | EquationRuleId;

/**
 * The presentation half of a rule, whichever catalogue it came from.
 *
 * `scope` is what tells the interface which affordance to use: a `term` rule
 * marks places under the expression, an `equation` rule offers itself against
 * the line. Callers switch on this rather than on the id.
 */
export type AnyRuleDefinition =
  | ({ scope: 'term' } & RuleDefinition)
  | ({ scope: 'equation' } & EquationRuleDefinition);

export type SubjectTransformation = {
  subject: Subject;
  rule: AnyRuleId;
  address: Address;
  argument?: RuleArgument;
  reason: string;
  detail: string;
};

export const ALL_RULES: AnyRuleDefinition[] = [
  ...RULES.map((rule) => ({ scope: 'term' as const, ...rule })),
  ...EQUATION_RULES.map((rule) => ({ scope: 'equation' as const, ...rule })),
];

export const ALL_RULE_IDS: AnyRuleId[] = ALL_RULES.map((rule) => rule.id);

export function isAnyRuleId(value: unknown): value is AnyRuleId {
  return isRuleId(value) || isEquationRuleId(value);
}

export function anyRuleById(id: AnyRuleId): AnyRuleDefinition {
  if (isEquationRuleId(id)) {
    const definition = EQUATION_RULES.find((rule) => rule.id === id);
    if (!definition) throw new RangeError(`Unknown rule "${String(id)}".`);
    return { scope: 'equation', ...definition };
  }
  return { scope: 'term', ...ruleById(id) };
}

/* ------------------------------------------------------------------ */
/* Where a rule applies                                                */
/* ------------------------------------------------------------------ */

/**
 * Every place the rule could be used on this line, left to right.
 *
 * On an equation, a term rule is asked for its targets on each side
 * independently and the results are tagged with the side. Ordering matters:
 * candidates are numbered for keyboard selection, and the numbering has to run
 * across the line the way the line is read.
 */
export function findAddresses(subject: Subject, rule: AnyRuleId): Address[] {
  if (isEquationRuleId(rule)) {
    // A whole-equation operation has nothing to act on in expression mode.
    if (!isEquation(subject)) return [];
    return equationRuleApplies(subject, rule) ? [{ kind: 'equation' }] : [];
  }

  if (!isEquation(subject)) {
    return findTargets(subject.term, rule).map((target) => ({
      kind: 'expression' as const,
      target,
    }));
  }

  return SIDES.flatMap((side) =>
    findTargets(sideTerm(subject, side), rule).map((target) => ({
      kind: 'side' as const,
      side,
      target,
    })),
  );
}

/* ------------------------------------------------------------------ */
/* Applying a rule                                                     */
/* ------------------------------------------------------------------ */

/**
 * Validate the address envelope before the rule sees it. The `Target` inside is
 * left to `applyRule`, which checks it against the term it addresses — a
 * well-typed path can still address nothing.
 */
function validateAddressShape(value: unknown): Address {
  if (typeof value !== 'object' || value === null) {
    throw new RangeError('Address must be an object.');
  }
  const address = value as { kind?: unknown; side?: unknown; target?: unknown };

  switch (address.kind) {
    case 'equation':
      return { kind: 'equation' };

    case 'expression':
      return { kind: 'expression', target: address.target as Target };

    case 'side': {
      if (address.side !== 'left' && address.side !== 'right') {
        throw new RangeError('Address side must be "left" or "right".');
      }
      return { kind: 'side', side: address.side as Side, target: address.target as Target };
    }

    default:
      throw new RangeError(`Unknown address kind ${JSON.stringify(address.kind)}.`);
  }
}

/**
 * The size budget, applied to the line as a whole.
 *
 * Term rules already bound their own result, but that check cannot see the
 * other side of an equation, and a whole-equation rule bypasses it entirely.
 * Checking here means one place is responsible for the limit regardless of
 * which catalogue the rule came from.
 */
function withinBudget(subject: Subject): boolean {
  return subjectDepth(subject) <= MAX_DEPTH && subjectNodeCount(subject) <= 2 * MAX_NODES;
}

/**
 * Apply one rule at one address. The address kind and the subject kind must
 * agree: a whole-equation operation cannot be aimed at an expression, and a
 * side address is meaningless without two sides.
 */
export function applyToSubject(
  subject: Subject,
  rule: AnyRuleId,
  address: unknown,
  argument?: RuleArgument,
): SubjectTransformation {
  const where = validateAddressShape(address);

  if (isEquationRuleId(rule)) {
    if (where.kind !== 'equation') {
      throw new RangeError(`Rule ${rule} applies to the whole equation.`);
    }
    if (!isEquation(subject)) {
      throw new RangeError(`Rule ${rule} needs an equation.`);
    }

    const checked = argument === undefined ? undefined : validateArgument(argument, rule);
    const { subject: next, detail } = applyEquationRule(subject, rule, checked);

    if (!withinBudget(next)) {
      throw new RangeError('That step would build an expression larger than the app supports.');
    }

    const definition = anyRuleById(rule);
    return {
      subject: next,
      rule,
      address: where,
      ...(checked ? { argument: checked } : {}),
      reason: definition.reason,
      detail,
    };
  }

  if (where.kind === 'equation') {
    throw new RangeError(`Rule ${rule} applies inside an expression, not to the whole equation.`);
  }

  if (isEquation(subject)) {
    if (where.kind !== 'side') {
      throw new RangeError('An equation needs a side for a local rewrite.');
    }
    const result = applyRule(sideTerm(subject, where.side), rule, where.target, argument);
    const next = replaceSide(subject, where.side, result.term);

    if (!withinBudget(next)) {
      throw new RangeError('That step would build an expression larger than the app supports.');
    }

    return {
      subject: next,
      rule,
      address: { kind: 'side', side: where.side, target: result.target },
      ...(result.argument ? { argument: result.argument } : {}),
      reason: result.reason,
      detail: `on the ${where.side}, ${result.detail}`,
    };
  }

  if (where.kind !== 'expression') {
    throw new RangeError('An expression has no sides.');
  }

  const result = applyRule(subject.term, rule, where.target, argument);
  return {
    subject: { kind: 'expression', term: result.term },
    rule,
    address: { kind: 'expression', target: result.target },
    ...(result.argument ? { argument: result.argument } : {}),
    reason: result.reason,
    detail: result.detail,
  };
}
