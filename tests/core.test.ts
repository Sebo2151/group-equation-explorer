import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyTransformation,
  cloneFactors,
  expressionSpeech,
  expressionTex,
  factorSpeech,
  factorTex,
  findTargets,
  isRuleId,
  layerTargets,
  RULES,
  sameTarget,
  spanSpeech,
  START,
  targetContains,
  validateFactor,
  validateFactors,
  type Factor,
  type RuleId,
} from '../app/core.ts';

const at = (start: number, end = start) => ({ start, end });

test('the opening expression exposes both inverse pairs', () => {
  assert.deepEqual(findTargets(START, 'inverse'), [at(0, 1), at(3, 4)]);
  assert.deepEqual(findTargets(START, 'identity'), []);
});

test('overlapping inverse pairs are all reported as distinct spans', () => {
  const factors: Factor[] = [{ base: 'a' }, { base: 'a', inverse: true }, { base: 'a' }];
  assert.deepEqual(findTargets(factors, 'inverse'), [at(0, 1), at(1, 2)]);
});

test('overlapping pairs rewrite differently depending on which span is chosen', () => {
  const factors: Factor[] = [{ base: 'a' }, { base: 'a', inverse: true }, { base: 'a' }];
  assert.equal(expressionTex(applyTransformation(factors, 'inverse', at(0, 1)).factors), 'ea');
  assert.equal(expressionTex(applyTransformation(factors, 'inverse', at(1, 2)).factors), 'ae');
});

test('inverse cancellation produces an explicit identity without mutating the input', () => {
  const original = cloneFactors(START);
  const result = applyTransformation(original, 'inverse', at(0, 1));

  assert.equal(expressionTex(result.factors), 'ebc^{-1}c');
  assert.equal(result.reason, 'Inverse law');
  assert.equal(expressionTex(original), 'aa^{-1}bc^{-1}c');
});

test('a transformation returns fresh factor objects, never aliases of the input', () => {
  const original = cloneFactors(START);
  const result = applyTransformation(original, 'inverse', at(0, 1));

  assert.ok(result.factors.every((factor) => !original.includes(factor)));

  // Mutating the result must not reach back into the source expression.
  result.factors[1].base = 'z';
  assert.equal(expressionTex(original), 'aa^{-1}bc^{-1}c');
});

test('a transformation records the rule and target that produced it', () => {
  const result = applyTransformation(START, 'inverse', at(3, 4));
  assert.equal(result.rule, 'inverse');
  assert.deepEqual(result.target, at(3, 4));
});

test('finding targets does not mutate the expression', () => {
  const factors = cloneFactors(START);
  const before = JSON.stringify(factors);
  findTargets(factors, 'inverse');
  findTargets(factors, 'identity');
  assert.equal(JSON.stringify(factors), before);
});

test('cloneFactors produces independent objects', () => {
  const clone = cloneFactors(START);
  clone[0].base = 'z';
  assert.equal(START[0].base, 'a');
});

test('identity removal recognizes every identity factor', () => {
  const factors: Factor[] = [
    { base: 'e', identity: true },
    { base: 'b' },
    { base: 'e', identity: true },
  ];
  assert.deepEqual(findTargets(factors, 'identity'), [at(0), at(2)]);
  assert.equal(expressionTex(applyTransformation(factors, 'identity', at(0)).factors), 'be');
});

test('a lone identity is not offered for removal, because the step would be invisible', () => {
  // The empty product renders as `e` too, so removing the sole `e` would consume
  // a move and change nothing on screen.
  const sole: Factor[] = [{ base: 'e', identity: true }];
  assert.deepEqual(findTargets(sole, 'identity'), []);
  assert.throws(() => applyTransformation(sole, 'identity', at(0)), /not valid/);
  assert.equal(expressionTex([]), 'e');
});

test('unequal or equally-signed bases never cancel', () => {
  const cases: [string, Factor[]][] = [
    ['ab^{-1}', [{ base: 'a' }, { base: 'b', inverse: true }]],
    ['aa', [{ base: 'a' }, { base: 'a' }]],
    ['a^{-1}a^{-1}', [{ base: 'a', inverse: true }, { base: 'a', inverse: true }]],
    ['ba^{-1}', [{ base: 'b' }, { base: 'a', inverse: true }]],
  ];
  for (const [label, factors] of cases) {
    assert.deepEqual(findTargets(factors, 'inverse'), [], label);
  }
});

test('identity factors do not participate in inverse matching', () => {
  const factors: Factor[] = [{ base: 'e', identity: true }, { base: 'e', identity: true }];
  assert.deepEqual(findTargets(factors, 'inverse'), []);
});

test('no rule reorders the surviving factors', () => {
  // Order matters in a nonabelian group; check the sequence, not the rendering.
  const factors: Factor[] = [
    { base: 'x' },
    { base: 'a' },
    { base: 'a', inverse: true },
    { base: 'y' },
  ];
  const result = applyTransformation(factors, 'inverse', at(1, 2));
  assert.deepEqual(result.factors, [
    { base: 'x' },
    { base: 'e', identity: true },
    { base: 'y' },
  ]);
});

test('cancellation is not commutation: separated inverses do not match', () => {
  const factors: Factor[] = [{ base: 'a' }, { base: 'b' }, { base: 'a', inverse: true }];
  assert.deepEqual(findTargets(factors, 'inverse'), []);
});

test('the example completes in four steps starting from either inverse pair', () => {
  const leftFirst: [RuleId, ReturnType<typeof at>][] = [
    ['inverse', at(0, 1)],
    ['identity', at(0)],
    ['inverse', at(1, 2)],
    ['identity', at(1)],
  ];
  const rightFirst: [RuleId, ReturnType<typeof at>][] = [
    ['inverse', at(3, 4)],
    ['identity', at(3)],
    ['inverse', at(0, 1)],
    ['identity', at(0)],
  ];

  for (const [label, path] of [['left first', leftFirst], ['right first', rightFirst]] as const) {
    let factors = cloneFactors(START);
    for (const [rule, target] of path) {
      factors = applyTransformation(factors, rule, target).factors;
    }
    assert.equal(expressionTex(factors), 'b', label);
  }
});

test('every intermediate expression along the left-first path is as expected', () => {
  const expected = ['ebc^{-1}c', 'bc^{-1}c', 'be', 'b'];
  const path: [RuleId, ReturnType<typeof at>][] = [
    ['inverse', at(0, 1)],
    ['identity', at(0)],
    ['inverse', at(1, 2)],
    ['identity', at(1)],
  ];

  let factors = cloneFactors(START);
  path.forEach(([rule, target], step) => {
    factors = applyTransformation(factors, rule, target).factors;
    assert.equal(expressionTex(factors), expected[step], `step ${step + 1}`);
  });
});

test('non-overlapping targets share a single layer', () => {
  // The opening challenge: two disjoint pairs, so one row of brackets.
  assert.deepEqual(layerTargets(findTargets(START, 'inverse')), [[at(0, 1), at(3, 4)]]);
  assert.deepEqual(layerTargets([]), []);
});

test('overlapping targets are separated into distinct layers', () => {
  // Each candidate must get its own control. Two pairs sharing a factor cannot
  // both be drawn on one row without collapsing onto that shared factor.
  const factors: Factor[] = [{ base: 'a' }, { base: 'a', inverse: true }, { base: 'a' }];
  assert.deepEqual(layerTargets(findTargets(factors, 'inverse')), [[at(0, 1)], [at(1, 2)]]);
});

test('layering keeps every target exactly once and never overlaps within a row', () => {
  const targets = [at(0, 1), at(1, 2), at(2, 3), at(5, 6), at(0, 3)];
  const rows = layerTargets(targets);

  assert.equal(rows.flat().length, targets.length);
  for (const target of targets) {
    assert.equal(rows.flat().filter((entry) => sameTarget(entry, target)).length, 1);
  }
  for (const row of rows) {
    for (let index = 1; index < row.length; index += 1) {
      assert.ok(row[index - 1].end < row[index].start, JSON.stringify(row));
    }
  }
});

test('layering does not mutate the targets it is given', () => {
  const targets = [at(3, 4), at(0, 1)];
  const before = JSON.stringify(targets);
  layerTargets(targets);
  assert.equal(JSON.stringify(targets), before);
});

test('targetContains covers the whole inclusive span', () => {
  assert.deepEqual([0, 1, 2, 3].map((i) => targetContains(at(1, 2), i)), [false, true, true, false]);
});

test('an invalid target is rejected by the engine', () => {
  assert.throws(() => applyTransformation(START, 'identity', at(0)), /not valid/);
  assert.throws(() => applyTransformation(START, 'inverse', at(1, 2)), /not valid/);
});

test('a well-formed target with the wrong span length is rejected', () => {
  // The span must match the rule's own target shape, not merely start correctly.
  assert.throws(() => applyTransformation(START, 'inverse', at(0, 0)), /not valid/);
  assert.throws(() => applyTransformation(START, 'inverse', at(0, 2)), /not valid/);
});

test('out-of-range, negative, fractional and NaN targets are rejected', () => {
  for (const target of [at(-1, 0), at(0.5, 1), at(99, 100), at(NaN, NaN), at(3, 1)]) {
    assert.throws(
      () => applyTransformation(START, 'inverse', target),
      /out-of-range/,
      JSON.stringify(target),
    );
  }
});

test('an unrecognized rule id is rejected instead of falling through to another rule', () => {
  // Regression guard: matching and rewriting used to dispatch on opposite
  // polarity of the same union, so an unknown id matched as `inverse` and then
  // rewrote as `identity`, deleting a factor and labelling it a group axiom.
  const factors: Factor[] = [{ base: 'a' }, { base: 'a', inverse: true }];
  assert.throws(() => findTargets(factors, 'bogus' as RuleId), /Unknown rule/);
  assert.throws(
    () => applyTransformation(factors, 'bogus' as RuleId, at(0, 1)),
    /Unknown rule/,
  );
});

test('every advertised rule is backed by an implementation', () => {
  for (const rule of RULES) {
    assert.ok(isRuleId(rule.id), rule.id);
    assert.doesNotThrow(() => findTargets(START, rule.id), rule.id);
  }
});

test('isRuleId rejects anything outside the union', () => {
  assert.ok(isRuleId('inverse') && isRuleId('identity'));
  for (const value of ['bogus', '', null, undefined, 0, {}]) {
    assert.equal(isRuleId(value), false, String(value));
  }
});

test('factor validation rejects conflicting and malformed factors', () => {
  assert.throws(() => validateFactor({ base: 'a', identity: true }), /must use the base/);
  assert.throws(() => validateFactor({ base: 'e', identity: true, inverse: true }), /cannot also be/);
  assert.throws(() => validateFactor({ base: 'e' }), /reserved for the identity/);
  assert.throws(() => validateFactor({ base: '' }), /not a valid generator/);
  assert.throws(() => validateFactor({ base: 'a b' }), /not a valid generator/);
  assert.throws(() => validateFactor({ base: '\\rule{9em}{9em}' }), /not a valid generator/);
  assert.throws(() => validateFactor({ base: 1 }), /must be a string/);
  assert.throws(() => validateFactor({ base: 'a', inverse: 'yes' }), /must be a boolean/);
  assert.throws(() => validateFactor(null), /expected an object/);
});

test('factor validation accepts and canonicalizes well-formed factors', () => {
  assert.deepEqual(validateFactor({ base: 'a' }), { base: 'a' });
  assert.deepEqual(validateFactor({ base: 'r2', inverse: true }), { base: 'r2', inverse: true });
  assert.deepEqual(validateFactor({ base: 'a', inverse: false }), { base: 'a' });
  assert.deepEqual(validateFactor({ base: 'e', identity: true }), { base: 'e', identity: true });
  assert.deepEqual(validateFactors(START), START);
  assert.throws(() => validateFactors('not an array'), /expected an array/);
  assert.throws(() => validateFactors([{ base: 'e' }]), /expression\[0\]/);
});

test('the opening expression is itself valid', () => {
  assert.doesNotThrow(() => validateFactors(START, 'START'));
});

test('rendering distinguishes generators, inverses and the identity', () => {
  assert.equal(factorTex({ base: 'a' }), 'a');
  assert.equal(factorTex({ base: 'a', inverse: true }), 'a^{-1}');
  assert.equal(factorTex({ base: 'e', identity: true }), 'e');
  assert.equal(expressionTex([]), 'e');
});

test('spoken forms never leak TeX source', () => {
  assert.equal(factorSpeech({ base: 'a', inverse: true }), 'a inverse');
  assert.equal(factorSpeech({ base: 'e', identity: true }), 'identity e');
  assert.equal(expressionSpeech(START), 'a, a inverse, b, c inverse, c');
  assert.equal(expressionSpeech([]), 'identity e');
  assert.equal(spanSpeech(START, at(0, 1)), 'a, a inverse');
  assert.equal(spanSpeech(START, at(3, 4)), 'c inverse, c');

  for (const speech of [expressionSpeech(START), spanSpeech(START, at(0, 1))]) {
    assert.doesNotMatch(speech, /[\\^{}]/, speech);
  }
});
