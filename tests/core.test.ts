import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyTransformation,
  cloneFactors,
  expressionTex,
  findCandidates,
  START,
  type Factor,
} from '../app/core.ts';

test('the opening expression exposes both inverse pairs', () => {
  assert.deepEqual(findCandidates(START, 'inverse'), [0, 3]);
  assert.deepEqual(findCandidates(START, 'identity'), []);
});

test('overlapping inverse pairs are all reported', () => {
  const factors: Factor[] = [
    { base: 'a' },
    { base: 'a', inverse: true },
    { base: 'a' },
  ];
  assert.deepEqual(findCandidates(factors, 'inverse'), [0, 1]);
});

test('inverse cancellation produces an explicit identity without mutating the input', () => {
  const original = cloneFactors(START);
  const result = applyTransformation(original, 'inverse', 0);

  assert.equal(expressionTex(result.factors), 'ebc^{-1}c');
  assert.equal(result.reason, 'Inverse law');
  assert.equal(expressionTex(original), 'aa^{-1}bc^{-1}c');
});

test('identity removal recognizes every identity factor', () => {
  const factors: Factor[] = [
    { base: 'e', identity: true },
    { base: 'b' },
    { base: 'e', identity: true },
  ];
  assert.deepEqual(findCandidates(factors, 'identity'), [0, 2]);
  assert.equal(expressionTex(applyTransformation(factors, 'identity', 0).factors), 'be');
});

test('a legal four-step proof reaches the target b', () => {
  let factors = cloneFactors(START);
  factors = applyTransformation(factors, 'inverse', 0).factors;
  factors = applyTransformation(factors, 'identity', 0).factors;
  factors = applyTransformation(factors, 'inverse', 1).factors;
  factors = applyTransformation(factors, 'identity', 1).factors;
  assert.equal(expressionTex(factors), 'b');
});

test('an invalid target is rejected by the engine', () => {
  assert.throws(
    () => applyTransformation(START, 'identity', 0),
    /not valid/,
  );
});
