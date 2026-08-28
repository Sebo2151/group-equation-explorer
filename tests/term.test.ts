import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  generator,
  getNode,
  hosts,
  identity,
  inverse,
  isGap,
  isInversePair,
  MAX_DEPTH,
  MAX_EXPONENT,
  nodeCount,
  normalizeTerm,
  power,
  product,
  replaceNode,
  replaceSpan,
  spanTerms,
  termDepth,
  termSource,
  termSpeech,
  termTex,
  termsEqual,
  validateTerm,
  type Target,
  type Term,
} from '../app/term.ts';

const a = generator('a');
const b = generator('b');
const c = generator('c');

/* Structure ------------------------------------------------------------- */

test('products are flattened by construction', () => {
  const nested = product([product([a, b]), c]);
  assert.equal(nested.kind, 'product');
  assert.deepEqual(nested, product([a, product([b, c])]));
  assert.equal(termSource(nested), 'a b c');
});

test('a product of one factor is that factor, and of none is the identity', () => {
  assert.deepEqual(product([a]), a);
  assert.deepEqual(product([]), identity());
});

test('structure under an inverse or a power is preserved', () => {
  const term = inverse(product([inverse(product([a, b])), c]));
  assert.equal(termSource(term), '((a b)^-1 c)^-1');
  assert.equal(termDepth(term), 5);
});

test('exponents 1 and -1 never reach a power node', () => {
  assert.deepEqual(power(a, 1), a);
  assert.deepEqual(power(a, -1), inverse(a));
  assert.equal(power(a, 0).kind, 'power');
  assert.equal(power(a, 2).kind, 'power');
});

test('normalize flattens throughout without simplifying', () => {
  const messy: Term = {
    kind: 'product',
    factors: [{ kind: 'product', factors: [a, identity()] } as Term, inverse(a)],
  };
  const clean = normalizeTerm(messy);
  assert.equal(termSource(clean), 'a e a^-1');
  // The identity factor and the inverse pair both survive: those are moves.
  assert.equal(nodeCount(clean), 5);
});

/* Equality -------------------------------------------------------------- */

test('equality is structural and order sensitive', () => {
  assert.ok(termsEqual(product([a, b]), product([a, b])));
  assert.ok(!termsEqual(product([a, b]), product([b, a])));
  assert.ok(!termsEqual(a, inverse(a)));
  assert.ok(!termsEqual(power(a, 2), power(b, 2)));
  assert.ok(!termsEqual(power(a, 2), power(a, 3)));
});

test('inverse pairs are recognised in either order, including powers', () => {
  assert.ok(isInversePair(a, inverse(a)));
  assert.ok(isInversePair(inverse(a), a));
  assert.ok(isInversePair(product([a, b]), inverse(product([a, b]))));
  assert.ok(isInversePair(power(a, 3), power(a, -3)));
  assert.ok(!isInversePair(a, inverse(b)));
  assert.ok(!isInversePair(power(a, 3), power(a, -2)));
  // Provably inverse but not visibly so: left for the rules to establish.
  assert.ok(!isInversePair(product([a, b]), product([inverse(b), inverse(a)])));
});

/* Paths and hosts ------------------------------------------------------- */

test('paths address nested nodes', () => {
  const term = product([inverse(product([a, b])), c]);
  assert.deepEqual(getNode(term, []), term);
  assert.deepEqual(getNode(term, [1]), c);
  assert.deepEqual(getNode(term, [0, 0, 1]), b);
  assert.throws(() => getNode(term, [9]), RangeError);
  assert.throws(() => getNode(term, [1, 0]), RangeError);
});

test('replaceNode rebuilds and re-flattens', () => {
  const term = product([a, inverse(b)]);
  assert.equal(termSource(replaceNode(term, [1], product([b, c]))), 'a b c');
  assert.equal(termSource(replaceNode(term, [1, 0], product([b, c]))), 'a (b c)^-1');
});

test('every node that can host a span is a host exactly once', () => {
  const term = product([inverse(product([a, b])), c]);
  assert.deepEqual(
    hosts(term).map(({ path, factors }) => [path.join('.'), factors.length]),
    [
      ['', 2],
      ['0.0', 2],
    ],
  );
});

test('a term that is not a product hosts itself', () => {
  assert.deepEqual(
    hosts(inverse(a)).map(({ path, factors }) => [path.join('.'), factors.length]),
    [
      ['', 1],
      ['0', 1],
    ],
  );
});

/* Spans ----------------------------------------------------------------- */

test('replaceSpan splices a span and rebuilds', () => {
  const term = product([a, inverse(a), b]);
  const target: Target = { path: [], start: 0, end: 1 };
  assert.deepEqual(spanTerms(term, target), [a, inverse(a)]);
  assert.equal(termSource(replaceSpan(term, target, [identity()])), 'e b');
  assert.equal(termSource(replaceSpan(term, target, [])), 'b');
});

test('an empty span is a gap and inserts without removing', () => {
  const term = product([a, b]);
  const gap: Target = { path: [], start: 1, end: 0 };
  assert.ok(isGap(gap));
  assert.deepEqual(spanTerms(term, gap), []);
  assert.equal(termSource(replaceSpan(term, gap, [c])), 'a c b');
  assert.equal(termSource(replaceSpan(term, { path: [], start: 2, end: 1 }, [c])), 'a b c');
});

test('a gap on a non-product host builds a product', () => {
  assert.equal(termSource(replaceSpan(a, { path: [], start: 0, end: -1 }, [b])), 'b a');
});

test('spans outside their host are rejected', () => {
  const term = product([a, b]);
  assert.throws(() => replaceSpan(term, { path: [], start: 0, end: 2 }, []), RangeError);
  assert.throws(() => replaceSpan(term, { path: [], start: 3, end: 2 }, []), RangeError);
  assert.throws(() => replaceSpan(term, { path: [], start: 1, end: -1 }, []), RangeError);
  assert.throws(() => replaceSpan(term, { path: [], start: 0.5, end: 1 }, []), RangeError);
});

test('replaceSpan does not mutate its input', () => {
  const term = product([a, inverse(a), b]);
  const snapshot = JSON.parse(JSON.stringify(term));
  replaceSpan(term, { path: [], start: 0, end: 1 }, [identity()]);
  assert.deepEqual(term, snapshot);
});

/* Validation ------------------------------------------------------------ */

test('validateTerm accepts what the model builds', () => {
  const term = product([inverse(product([a, b])), power(c, 3), identity()]);
  assert.deepEqual(validateTerm(JSON.parse(JSON.stringify(term))), term);
});

test('validateTerm rejects malformed data', () => {
  assert.throws(() => validateTerm(null), TypeError);
  assert.throws(() => validateTerm([a]), TypeError);
  assert.throws(() => validateTerm({ kind: 'nope' }), TypeError);
  assert.throws(() => validateTerm({ kind: 'generator', name: 'e' }), TypeError);
  assert.throws(() => validateTerm({ kind: 'generator', name: '1a' }), TypeError);
  assert.throws(() => validateTerm({ kind: 'generator', name: 'a\\rule{9em}{9em}' }), TypeError);
  assert.throws(() => validateTerm({ kind: 'product', factors: [a] }), TypeError);
  assert.throws(
    () => validateTerm({ kind: 'product', factors: [{ kind: 'product', factors: [a, b] }, c] }),
    TypeError,
  );
  assert.throws(() => validateTerm({ kind: 'power', base: a, exponent: 1.5 }), TypeError);
  assert.throws(() => validateTerm({ kind: 'power', base: a, exponent: -1 }), TypeError);
  assert.throws(
    () => validateTerm({ kind: 'power', base: a, exponent: MAX_EXPONENT + 1 }),
    TypeError,
  );
});

test('validateTerm rejects terms that are too deep or too large', () => {
  let deep: Term = a;
  for (let index = 0; index < MAX_DEPTH; index += 1) deep = inverse(deep);
  assert.throws(() => validateTerm(deep), /deeper than/);
});

/* Rendering ------------------------------------------------------------- */

test('TeX parenthesises only what needs it, and subscripts digits', () => {
  assert.equal(termTex(product([a, inverse(b)])), 'ab^{-1}');
  assert.equal(termTex(inverse(product([a, b]))), '\\left(ab\\right)^{-1}');
  assert.equal(termTex(power(inverse(a), 3)), '\\left(a^{-1}\\right)^{3}');
  assert.equal(termTex(generator('r2')), 'r_{2}');
  assert.equal(termTex(identity()), 'e');
});

test('spoken forms never contain TeX', () => {
  const terms = [
    product([a, inverse(b)]),
    inverse(product([a, b])),
    power(inverse(a), -3),
    power(a, 0),
    identity(),
    generator('r2'),
  ];
  for (const term of terms) {
    const speech = termSpeech(term);
    assert.doesNotMatch(speech, /[\\^{}]/, `spoken form leaked TeX: ${speech}`);
    assert.ok(speech.length > 0);
  }
  assert.equal(termSpeech(power(a, -3)), 'a to the power negative 3');
  assert.equal(termSpeech(inverse(product([a, b]))), 'the inverse of, a times b, end inverse');
});
