/**
 * What a proof line is *about*.
 *
 * Phase 2 proved things about a single expression: a chain of terms joined by
 * `=`, each link justified by a law. Phase 3 adds a second thing a line can be,
 * an equation, and the chain that joins those is `⟺` rather than `=`.
 *
 * The seam is deliberately here, one level above `Term`, and not inside it. An
 * equation is not a term: it cannot sit under an inverse, it cannot be a factor
 * in a product, and `product`'s associative flattening would have no meaning
 * for it. Adding an equation node to `Term` would force every rule in the
 * catalogue, plus `validateTerm` and `product`, to guard against a case that is
 * never legal — for no gain, because nothing in the term model needs to know
 * that equations exist. Keeping `Term` closed is what lets all fourteen Phase 2
 * laws apply to one side of an equation without being rewritten.
 */

import {
  nodeCount,
  termDepth,
  termSource,
  termSpeech,
  termTex,
  termsEqual,
  validateTerm,
  type Target,
  type Term,
} from './term.ts';

export type Side = 'left' | 'right';

export const SIDES: Side[] = ['left', 'right'];

export type Expression = { kind: 'expression'; term: Term };
export type Equation = { kind: 'equation'; left: Term; right: Term };

export type Subject = Expression | Equation;

/**
 * Where a law is being applied on a line.
 *
 * The three cases are not cosmetic. A local rewrite carries a `Target` — the
 * span or gap the Phase 2 bracket machinery already knows how to draw — while a
 * whole-equation operation carries none, because there is nothing on the line
 * for it to point at. That is the distinction the plan asks to be made "clear",
 * and making it a difference in the type rather than a difference in styling is
 * what stops the two ever being presented as though they were the same kind of
 * move.
 */
export type Address =
  | { kind: 'expression'; target: Target }
  | { kind: 'side'; side: Side; target: Target }
  | { kind: 'equation' };

/* ------------------------------------------------------------------ */
/* Construction                                                        */
/* ------------------------------------------------------------------ */

export function expression(term: Term): Expression {
  return { kind: 'expression', term };
}

export function equation(left: Term, right: Term): Equation {
  return { kind: 'equation', left, right };
}

export function isEquation(subject: Subject): subject is Equation {
  return subject.kind === 'equation';
}

/** The term on one side. Callers that already narrowed may index directly. */
export function sideTerm(subject: Equation, side: Side): Term {
  return side === 'left' ? subject.left : subject.right;
}

/** Rebuild an equation with one side replaced. Never mutates. */
export function replaceSide(subject: Equation, side: Side, term: Term): Equation {
  return side === 'left' ? equation(term, subject.right) : equation(subject.left, term);
}

/** Both terms a subject contains, left to right. */
export function subjectTerms(subject: Subject): Term[] {
  return subject.kind === 'expression' ? [subject.term] : [subject.left, subject.right];
}

/* ------------------------------------------------------------------ */
/* Equality                                                            */
/* ------------------------------------------------------------------ */

/**
 * Structural equality, and deliberately orientation-sensitive: `u = v` is not
 * the same subject as `v = u`.
 *
 * Symmetry is a law in the catalogue, so a learner who has reached `a^-1 b = x`
 * when the goal is `x = a^-1 b` has one justified step left to take. Treating
 * the two as already equal would hand out the step for free and quietly remove
 * the only reason symmetry is ever exercised. This is the same reasoning that
 * keeps `x^1` out of the model and `x^0 = e` in it: notation is free, but a
 * mathematical move costs a step.
 */
export function subjectsEqual(left: Subject, right: Subject): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'expression') {
    return termsEqual(left.term, (right as Expression).term);
  }
  const other = right as Equation;
  return termsEqual(left.left, other.left) && termsEqual(left.right, other.right);
}

/* ------------------------------------------------------------------ */
/* Size                                                                */
/* ------------------------------------------------------------------ */

export function subjectNodeCount(subject: Subject): number {
  return subjectTerms(subject).reduce((total, term) => total + nodeCount(term), 0);
}

export function subjectDepth(subject: Subject): number {
  return subjectTerms(subject).reduce((deepest, term) => Math.max(deepest, termDepth(term)), 0);
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

/**
 * Reject malformed subjects arriving as unknown data — an imported record, a
 * URL fragment, or challenge data.
 *
 * Each side is validated by `validateTerm`, so the depth and node limits are
 * enforced per side. An equation may therefore reach twice the node budget of a
 * single expression, which is intended: an equation *is* two expressions, and
 * halving each side's allowance would make equation mode strictly weaker than
 * expression mode for no reason. Rendering cost stays linear in the total.
 */
export function validateSubject(value: unknown, where = 'subject'): Subject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${where}: expected a subject object.`);
  }
  const node = value as Record<string, unknown>;

  switch (node.kind) {
    case 'expression':
      return expression(validateTerm(node.term, `${where}.term`));

    case 'equation':
      return equation(
        validateTerm(node.left, `${where}.left`),
        validateTerm(node.right, `${where}.right`),
      );

    default:
      throw new TypeError(`${where}: unknown subject kind ${JSON.stringify(node.kind)}.`);
  }
}

/* ------------------------------------------------------------------ */
/* Renderings                                                          */
/* ------------------------------------------------------------------ */

export function subjectTex(subject: Subject): string {
  return subject.kind === 'expression'
    ? termTex(subject.term)
    : `${termTex(subject.left)} = ${termTex(subject.right)}`;
}

/** Screen-reader form. TeX source must never reach an accessible name. */
export function subjectSpeech(subject: Subject): string {
  return subject.kind === 'expression'
    ? termSpeech(subject.term)
    : `${termSpeech(subject.left)} equals ${termSpeech(subject.right)}`;
}

/**
 * Canonical source text. `parseSubject(subjectSource(s))` reproduces `s`, which
 * is what lets a proof be exported and re-imported without a second encoding.
 */
export function subjectSource(subject: Subject): string {
  return subject.kind === 'expression'
    ? termSource(subject.term)
    : `${termSource(subject.left)} = ${termSource(subject.right)}`;
}
