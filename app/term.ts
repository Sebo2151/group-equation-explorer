/**
 * The recursive term model.
 *
 * A term is a generator, the identity, a product, an inverse, or an integer
 * power. Products are kept flat: associativity is a structural fact about the
 * representation, not a move the learner has to make. Nothing else is
 * normalised here — identity factors are not removed, inverse pairs are not
 * cancelled, inverses are not distributed, and powers are not expanded or
 * combined. Those are exactly the steps the app exists to teach, so they live
 * in the rule catalogue where each one costs a justified step.
 */

export type Generator = { kind: 'generator'; name: string };
export type Identity = { kind: 'identity' };
export type Product = { kind: 'product'; factors: Term[] };
export type Inverse = { kind: 'inverse'; term: Term };
export type Power = { kind: 'power'; base: Term; exponent: number };

export type Term = Generator | Identity | Product | Inverse | Power;

/**
 * A path addresses a node by descending child indices: a factor index inside a
 * product, `0` for the term under an inverse, `0` for the base of a power.
 */
export type Path = number[];

/**
 * A contiguous span of factors inside the host at `path`, both ends inclusive.
 *
 * A node that is not a product is treated as a one-factor list, so `0..0`
 * addresses the node itself. An empty span — `end === start - 1` — is the gap
 * before factor `start`, which is what insertion rules attach to.
 */
export type Target = { path: Path; start: number; end: number };

/**
 * Generators are one letter, optionally followed by digits: `a`, `x`, `r2`.
 * Everything here is interpolated into TeX, so the accepted alphabet is
 * deliberately narrow rather than escaped after the fact. `e` is reserved so
 * that a rendered `e` always means the identity.
 */
export const GENERATOR_PATTERN = /^[A-Za-z][0-9]*$/;

/** Structural limits. They bound rendering cost and bound imported data. */
export const MAX_EXPONENT = 64;
export const MAX_DEPTH = 16;
export const MAX_NODES = 400;

export const IDENTITY: Identity = { kind: 'identity' };

export function generator(name: string): Generator {
  return { kind: 'generator', name };
}

export function identity(): Identity {
  return IDENTITY;
}

export function inverse(term: Term): Inverse {
  return { kind: 'inverse', term };
}

/**
 * Exponents 1 and -1 are kept out of the power node, because `x^1` is just `x`
 * and `x^{-1}` is just the inverse. Two spellings of one term would make
 * structural equality — and therefore every rule that matches on it — wrong.
 * This is notation, not simplification: exponent 0 is kept, since `x^0 = e` is
 * a step worth taking explicitly.
 */
export function power(base: Term, exponent: number): Term {
  if (exponent === 1) return base;
  if (exponent === -1) return inverse(base);
  return { kind: 'power', base, exponent };
}

/**
 * Build a product from a factor list, applying associative flattening and
 * nothing else. An empty list is the identity and a single factor is itself,
 * so a `product` node always has at least two non-product factors.
 */
export function product(factors: Term[]): Term {
  const flat: Term[] = [];
  for (const factor of factors) {
    if (factor.kind === 'product') flat.push(...factor.factors);
    else flat.push(factor);
  }
  if (flat.length === 0) return identity();
  if (flat.length === 1) return flat[0];
  return { kind: 'product', factors: flat };
}

/** Re-apply associative flattening throughout a tree. */
export function normalizeTerm(term: Term): Term {
  switch (term.kind) {
    case 'generator':
    case 'identity':
      return term;
    case 'inverse':
      return inverse(normalizeTerm(term.term));
    case 'power':
      return power(normalizeTerm(term.base), term.exponent);
    case 'product':
      return product(term.factors.map(normalizeTerm));
  }
}

export function termsEqual(left: Term, right: Term): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case 'generator':
      return left.name === (right as Generator).name;
    case 'identity':
      return true;
    case 'inverse':
      return termsEqual(left.term, (right as Inverse).term);
    case 'power':
      return (
        left.exponent === (right as Power).exponent && termsEqual(left.base, (right as Power).base)
      );
    case 'product': {
      const other = right as Product;
      return (
        left.factors.length === other.factors.length &&
        left.factors.every((factor, index) => termsEqual(factor, other.factors[index]))
      );
    }
  }
}

/**
 * Whether two terms are visibly an inverse pair. Structural only: it says `x`
 * and `x^{-1}` cancel, and `x^n` and `x^{-n}` cancel, but it does not attempt
 * to decide terms that are merely provably inverse.
 */
export function isInversePair(left: Term, right: Term): boolean {
  if (left.kind === 'inverse' && termsEqual(left.term, right)) return true;
  if (right.kind === 'inverse' && termsEqual(right.term, left)) return true;
  if (left.kind === 'power' && right.kind === 'power') {
    return left.exponent === -right.exponent && termsEqual(left.base, right.base);
  }
  return false;
}

export function children(term: Term): Term[] {
  switch (term.kind) {
    case 'product':
      return term.factors;
    case 'inverse':
      return [term.term];
    case 'power':
      return [term.base];
    default:
      return [];
  }
}

function withChildren(term: Term, next: Term[]): Term {
  switch (term.kind) {
    case 'product':
      return product(next);
    case 'inverse':
      return inverse(next[0]);
    case 'power':
      return power(next[0], term.exponent);
    default:
      return term;
  }
}

export function pathKey(path: Path): string {
  return path.join('.');
}

export function pathsEqual(left: Path, right: Path): boolean {
  return left.length === right.length && left.every((step, index) => step === right[index]);
}

export function sameTarget(left: Target, right: Target): boolean {
  return pathsEqual(left.path, right.path) && left.start === right.start && left.end === right.end;
}

export function getNode(root: Term, path: Path): Term {
  let node = root;
  for (const step of path) {
    const kids = children(node);
    if (!Number.isInteger(step) || step < 0 || step >= kids.length) {
      throw new RangeError(`No node at path ${pathKey(path)}.`);
    }
    node = kids[step];
  }
  return node;
}

/** Whether a path addresses a node that exists in `root`. */
export function hasNode(root: Term, path: Path): boolean {
  try {
    getNode(root, path);
    return true;
  } catch {
    return false;
  }
}

/** Replace the node at `path`, re-flattening products on the way back out. */
export function replaceNode(root: Term, path: Path, next: Term): Term {
  if (path.length === 0) return normalizeTerm(next);
  const [step, ...rest] = path;
  const kids = children(root);
  if (!Number.isInteger(step) || step < 0 || step >= kids.length) {
    throw new RangeError(`No node at path ${pathKey(path)}.`);
  }
  const updated = kids.map((child, index) =>
    index === step ? replaceNode(child, rest, next) : child,
  );
  return withChildren(root, updated);
}

/**
 * The factor list a target's span indexes into. A node that is not a product
 * behaves as a one-factor list, so every node can host a span or a gap without
 * the rules needing two code paths.
 */
export function hostFactors(node: Term): Term[] {
  return node.kind === 'product' ? node.factors : [node];
}

/**
 * Every node that can host a span. A product hosts its own factors; a node that
 * is not a product hosts itself, but only when its parent is not a product —
 * otherwise its single-factor span would duplicate a span of its parent and
 * produce two controls for one rewrite.
 */
export function hosts(root: Term): { path: Path; factors: Term[] }[] {
  const found: { path: Path; factors: Term[] }[] = [];

  const visit = (node: Term, path: Path, parentIsProduct: boolean) => {
    if (node.kind === 'product' || !parentIsProduct) {
      found.push({ path, factors: hostFactors(node) });
    }
    children(node).forEach((child, index) => {
      visit(child, [...path, index], node.kind === 'product');
    });
  };

  visit(root, [], false);
  return found;
}

export function isGap(target: Target): boolean {
  return target.end === target.start - 1;
}

export function spanTerms(root: Term, target: Target): Term[] {
  const factors = hostFactors(getNode(root, target.path));
  return factors.slice(target.start, target.end + 1);
}

/**
 * Replace a target's span of factors with `replacement`, then rebuild. An empty
 * span inserts without removing anything, which is what the insertion rules
 * need; the surrounding product is re-flattened by `product`.
 */
export function replaceSpan(root: Term, target: Target, replacement: Term[]): Term {
  const node = getNode(root, target.path);
  const factors = hostFactors(node);
  const { start, end } = target;

  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    throw new RangeError('Target span must use integer bounds.');
  }
  if (start < 0 || start > factors.length) {
    throw new RangeError(`Target span starts outside the host at ${pathKey(target.path)}.`);
  }
  if (end < start - 1 || end >= factors.length) {
    throw new RangeError(`Target span ends outside the host at ${pathKey(target.path)}.`);
  }

  const next = [...factors];
  next.splice(start, end - start + 1, ...replacement);
  return replaceNode(root, target.path, product(next));
}

export function nodeCount(term: Term): number {
  return 1 + children(term).reduce((total, child) => total + nodeCount(child), 0);
}

export function termDepth(term: Term): number {
  return 1 + children(term).reduce((deepest, child) => Math.max(deepest, termDepth(child)), 0);
}

/**
 * Reject malformed terms before they reach the renderer or a rule. Structural
 * types are not enough: imported JSON, a URL fragment, and the parser all
 * arrive as unknown data.
 */
export function validateTerm(value: unknown, where = 'term'): Term {
  const term = validateShape(value, where);
  if (termDepth(term) > MAX_DEPTH) {
    throw new TypeError(`${where}: nesting is deeper than ${MAX_DEPTH} levels.`);
  }
  if (nodeCount(term) > MAX_NODES) {
    throw new TypeError(`${where}: term has more than ${MAX_NODES} nodes.`);
  }
  return term;
}

function validateShape(value: unknown, where: string): Term {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${where}: expected a term object.`);
  }
  const node = value as Record<string, unknown>;

  switch (node.kind) {
    case 'identity':
      return identity();

    case 'generator': {
      if (typeof node.name !== 'string') {
        throw new TypeError(`${where}: generator name must be a string.`);
      }
      if (node.name === 'e') {
        throw new TypeError(`${where}: "e" is reserved for the identity.`);
      }
      if (!GENERATOR_PATTERN.test(node.name)) {
        throw new TypeError(`${where}: "${node.name}" is not a valid generator name.`);
      }
      return generator(node.name);
    }

    case 'inverse':
      return inverse(validateShape(node.term, `${where}.term`));

    case 'power': {
      const { exponent } = node;
      if (typeof exponent !== 'number' || !Number.isInteger(exponent)) {
        throw new TypeError(`${where}: exponent must be an integer.`);
      }
      if (exponent === 1 || exponent === -1) {
        throw new TypeError(
          `${where}: exponent ${exponent} is written as the term itself or its inverse.`,
        );
      }
      if (Math.abs(exponent) > MAX_EXPONENT) {
        throw new TypeError(`${where}: exponent magnitude exceeds ${MAX_EXPONENT}.`);
      }
      return { kind: 'power', base: validateShape(node.base, `${where}.base`), exponent };
    }

    case 'product': {
      if (!Array.isArray(node.factors)) {
        throw new TypeError(`${where}: product factors must be an array.`);
      }
      if (node.factors.length < 2) {
        throw new TypeError(`${where}: a product needs at least two factors.`);
      }
      const factors = node.factors.map((factor, index) =>
        validateShape(factor, `${where}.factors[${index}]`),
      );
      if (factors.some((factor) => factor.kind === 'product')) {
        throw new TypeError(`${where}: products must be flat.`);
      }
      return { kind: 'product', factors };
    }

    default:
      throw new TypeError(`${where}: unknown term kind ${JSON.stringify(node.kind)}.`);
  }
}

function needsParentheses(term: Term): boolean {
  return term.kind !== 'generator' && term.kind !== 'identity';
}

/**
 * Digits in a generator name typeset as a subscript, so `r2` reads as one
 * symbol rather than as `r` times `2`. The name still matched
 * `GENERATOR_PATTERN`, so nothing but letters and digits reaches TeX.
 */
export function generatorTex(name: string): string {
  const digits = name.slice(1);
  return digits ? `${name[0]}_{${digits}}` : name;
}

export function termTex(term: Term): string {
  switch (term.kind) {
    case 'generator':
      return generatorTex(term.name);
    case 'identity':
      return 'e';
    case 'product':
      return term.factors.map(termTex).join('');
    case 'inverse':
      return `${atomTex(term.term)}^{-1}`;
    case 'power':
      return `${atomTex(term.base)}^{${term.exponent}}`;
  }
}

function atomTex(term: Term): string {
  return needsParentheses(term) ? `\\left(${termTex(term)}\\right)` : termTex(term);
}

/** Screen-reader form. TeX source must never reach an accessible name. */
export function termSpeech(term: Term): string {
  switch (term.kind) {
    case 'generator':
      return term.name;
    case 'identity':
      return 'identity e';
    case 'product':
      return term.factors.map(termSpeech).join(' times ');
    case 'inverse':
      return needsParentheses(term.term)
        ? `the inverse of, ${termSpeech(term.term)}, end inverse`
        : `${termSpeech(term.term)} inverse`;
    case 'power': {
      const exponent = exponentSpeech(term.exponent);
      return needsParentheses(term.base)
        ? `the quantity, ${termSpeech(term.base)}, to the power ${exponent}`
        : `${termSpeech(term.base)} to the power ${exponent}`;
    }
  }
}

function exponentSpeech(exponent: number): string {
  return exponent < 0 ? `negative ${Math.abs(exponent)}` : `${exponent}`;
}

export function spanSpeech(terms: Term[]): string {
  return terms.length ? terms.map(termSpeech).join(' times ') : 'this gap';
}

/**
 * Canonical source text. `parseTerm(termSource(t))` reproduces `t`, which is
 * what lets a proof be exported and re-imported without a second encoding.
 */
export function termSource(term: Term): string {
  switch (term.kind) {
    case 'generator':
      return term.name;
    case 'identity':
      return 'e';
    case 'product':
      return term.factors.map(termSource).join(' ');
    case 'inverse':
      return `${atomSource(term.term)}^-1`;
    case 'power':
      return `${atomSource(term.base)}^${term.exponent}`;
  }
}

function atomSource(term: Term): string {
  return needsParentheses(term) ? `(${termSource(term)})` : termSource(term);
}
