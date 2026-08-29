import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseTerm } from '../app/parse.ts';
import {
  applyRule,
  findTargets,
  isRuleId,
  ruleById,
  RULE_IDS,
  RULES,
  type RuleId,
} from '../app/rules.ts';
import { isGap, termSource, type Target } from '../app/term.ts';

function at(text: string, rule: RuleId): Target[] {
  return findTargets(parseTerm(text), rule);
}

/** Apply a rule and report the resulting expression as source text. */
function step(text: string, rule: RuleId, target: Target, argument?: { term: string; inverseFirst?: boolean }) {
  return termSource(
    applyRule(
      parseTerm(text),
      rule,
      target,
      argument && {
        term: parseTerm(argument.term),
        ...(argument.inverseFirst ? { inverseFirst: true } : {}),
      },
    ).term,
  );
}

/* Catalogue integrity ---------------------------------------------------- */

test('every advertised rule has an implementation, and nothing else exists', () => {
  assert.equal(RULES.length, RULE_IDS.length);
  for (const rule of RULES) {
    assert.ok(isRuleId(rule.id));
    assert.deepEqual(ruleById(rule.id), rule);
    // Both halves come from the same entry, so a rule cannot match as one
    // thing and rewrite as another.
    assert.doesNotThrow(() => findTargets(parseTerm('a a^-1 b'), rule.id));
  }
});

test('an unknown rule id is a lookup failure, not a fallthrough', () => {
  const bogus = 'cancel-everything' as RuleId;
  assert.equal(isRuleId(bogus), false);
  assert.throws(() => findTargets(parseTerm('a a^-1'), bogus), /Unknown rule/);
  assert.throws(() => applyRule(parseTerm('a a^-1'), bogus, { path: [], start: 0, end: 1 }), /Unknown rule/);
});

test('no rule formula or description leaks into an accessible name', () => {
  for (const rule of RULES) {
    assert.doesNotMatch(rule.spokenFormula, /[\\^{}]/, rule.id);
    assert.doesNotMatch(rule.name, /[\\^{}]/, rule.id);
    assert.doesNotMatch(rule.reason, /[\\^{}]/, rule.id);
    assert.doesNotMatch(rule.description, /[\\^{}]/, rule.id);
  }
});

test('gap rules offer only gaps and span rules offer only spans', () => {
  const term = parseTerm('(ab)^-1 a^2 b');
  for (const rule of RULES) {
    for (const target of findTargets(term, rule.id)) {
      assert.equal(isGap(target), rule.attachesToGaps, `${rule.id} offered the wrong kind of target`);
    }
  }
});

/* Cancellation and identity --------------------------------------------- */

test('cancel-inverse finds adjacent pairs in either order and nothing else', () => {
  assert.deepEqual(at('a a^-1 b c^-1 c', 'cancel-inverse'), [
    { path: [], start: 0, end: 1 },
    { path: [], start: 3, end: 4 },
  ]);
  assert.deepEqual(at('a b a^-1', 'cancel-inverse'), []);
  assert.deepEqual(at('a b^-1', 'cancel-inverse'), []);
});

test('cancel-inverse never commutes factors or cancels unequal bases', () => {
  assert.equal(step('a a^-1 b', 'cancel-inverse', { path: [], start: 0, end: 1 }), 'e b');
  assert.throws(
    () => step('a b a^-1', 'cancel-inverse', { path: [], start: 0, end: 2 }),
    /does not apply/,
  );
  assert.throws(
    () => step('a b^-1', 'cancel-inverse', { path: [], start: 0, end: 1 }),
    /does not apply/,
  );
});

test('cancel-inverse works on compound terms and on powers', () => {
  // `(ab)(ab)^-1` flattens to `a b (a b)^-1` first: associativity is structural,
  // so the compound is only a single factor where it genuinely is one.
  assert.equal(termSource(parseTerm('(ab) (ab)^-1 c')), 'a b (a b)^-1 c');
  assert.equal(
    step('(ab)^2 ((ab)^2)^-1 c', 'cancel-inverse', { path: [], start: 0, end: 1 }),
    'e c',
  );
  assert.equal(step('a^3 a^-3', 'cancel-inverse', { path: [], start: 0, end: 1 }), 'e');
});

test('overlapping cancellations are reported as separate targets', () => {
  assert.deepEqual(at('a a^-1 a', 'cancel-inverse'), [
    { path: [], start: 0, end: 1 },
    { path: [], start: 1, end: 2 },
  ]);
  assert.equal(step('a a^-1 a', 'cancel-inverse', { path: [], start: 0, end: 1 }), 'e a');
  assert.equal(step('a a^-1 a', 'cancel-inverse', { path: [], start: 1, end: 2 }), 'a e');
});

test('remove-identity leaves a lone identity alone', () => {
  assert.deepEqual(at('e', 'remove-identity'), []);
  assert.deepEqual(at('a e b', 'remove-identity'), [{ path: [], start: 1, end: 1 }]);
  assert.equal(step('a e b', 'remove-identity', { path: [], start: 1, end: 1 }), 'a b');
  assert.equal(step('e b', 'remove-identity', { path: [], start: 0, end: 0 }), 'b');
});

test('insert-identity marks every gap, both ends included', () => {
  assert.deepEqual(at('a b', 'insert-identity'), [
    { path: [], start: 0, end: -1 },
    { path: [], start: 1, end: 0 },
    { path: [], start: 2, end: 1 },
  ]);
  assert.equal(step('a b', 'insert-identity', { path: [], start: 0, end: -1 }), 'e a b');
  assert.equal(step('a b', 'insert-identity', { path: [], start: 2, end: 1 }), 'a b e');
});

test('inverse-of-identity turns e inverse back into e', () => {
  assert.deepEqual(at('e^-1 a', 'inverse-of-identity'), [{ path: [], start: 0, end: 0 }]);
  assert.equal(step('e^-1 a', 'inverse-of-identity', { path: [], start: 0, end: 0 }), 'e a');
});

/* Insertion -------------------------------------------------------------- */

test('insert-inverse-pair needs a term and honours the order', () => {
  assert.throws(
    () => applyRule(parseTerm('b'), 'insert-inverse-pair', { path: [], start: 0, end: -1 }),
    /needs a term/,
  );
  assert.equal(
    step('b', 'insert-inverse-pair', { path: [], start: 0, end: -1 }, { term: 'a' }),
    'a a^-1 b',
  );
  assert.equal(
    step('b', 'insert-inverse-pair', { path: [], start: 0, end: -1 }, { term: 'a', inverseFirst: true }),
    'a^-1 a b',
  );
  // The inserted product flattens into the surrounding one, but its inverse
  // keeps the structure: that is associativity, not a cancellation.
  assert.equal(
    step('b', 'insert-inverse-pair', { path: [], start: 1, end: 0 }, { term: '(cd)' }),
    'b c d (c d)^-1',
  );
});

test('a supplied term is validated like any other input', () => {
  assert.throws(
    () =>
      applyRule(parseTerm('b'), 'insert-inverse-pair', { path: [], start: 0, end: -1 }, {
        term: { kind: 'generator', name: 'e' } as never,
      }),
    /reserved/,
  );
  assert.throws(
    () =>
      applyRule(parseTerm('b'), 'insert-inverse-pair', { path: [], start: 0, end: -1 }, {
        term: { kind: 'generator', name: 'a' },
        inverseFirst: 'yes' as never,
      }),
    /boolean/,
  );
});

/* Inverses --------------------------------------------------------------- */

test('double-inverse only matches an inverse of an inverse', () => {
  assert.deepEqual(at('(a^-1)^-1 b', 'double-inverse'), [{ path: [], start: 0, end: 0 }]);
  assert.deepEqual(at('a^-1 b', 'double-inverse'), []);
  assert.equal(step('(a^-1)^-1 b', 'double-inverse', { path: [], start: 0, end: 0 }), 'a b');
});

test('wrap-double-inverse is the reverse direction', () => {
  assert.equal(step('a b', 'wrap-double-inverse', { path: [], start: 0, end: 0 }), '(a^-1)^-1 b');
  assert.equal(step('(a^-1)^-1 b', 'double-inverse', { path: [], start: 0, end: 0 }), 'a b');
});

test('inverse-of-product reverses the order', () => {
  assert.equal(step('(ab)^-1', 'inverse-of-product', { path: [], start: 0, end: 0 }), 'b^-1 a^-1');
  assert.equal(
    step('(abc)^-1 d', 'inverse-of-product', { path: [], start: 0, end: 0 }),
    'c^-1 b^-1 a^-1 d',
  );
  assert.deepEqual(at('a^-1 b', 'inverse-of-product'), []);
});

test('combine-inverses is the reverse direction, over any contiguous run', () => {
  assert.deepEqual(at('c^-1 b^-1 a^-1', 'combine-inverses'), [
    { path: [], start: 0, end: 1 },
    { path: [], start: 0, end: 2 },
    { path: [], start: 1, end: 2 },
  ]);
  assert.equal(
    step('c^-1 b^-1 a^-1', 'combine-inverses', { path: [], start: 0, end: 2 }),
    '(a b c)^-1',
  );
  assert.equal(
    step('c^-1 b^-1 a^-1', 'combine-inverses', { path: [], start: 0, end: 1 }),
    '(b c)^-1 a^-1',
  );
  assert.deepEqual(at('a^-1 b', 'combine-inverses'), []);
});

/* Powers ----------------------------------------------------------------- */

test('expand-power writes out positive and negative exponents', () => {
  assert.equal(step('a^3 b', 'expand-power', { path: [], start: 0, end: 0 }), 'a a a b');
  assert.equal(step('a^-3 b', 'expand-power', { path: [], start: 0, end: 0 }), 'a^-1 a^-1 a^-1 b');
  assert.equal(step('(ab)^2', 'expand-power', { path: [], start: 0, end: 0 }), 'a b a b');
  assert.deepEqual(at('a^0', 'expand-power'), []);
  assert.deepEqual(at('a b', 'expand-power'), []);
});

test('expand-power is not offered when it would exceed the size budget', () => {
  // Seven factors expanded 64 times is 449 nodes, past the 400-node budget.
  assert.deepEqual(at('(a b c d f g h)^64', 'expand-power'), []);
  assert.equal(at('(a b c d f g)^64', 'expand-power').length, 1);
});

test('combine-powers adds exponents of the same base only', () => {
  assert.equal(step('a^3 a^-2', 'combine-powers', { path: [], start: 0, end: 1 }), 'a');
  assert.equal(step('a a', 'combine-powers', { path: [], start: 0, end: 1 }), 'a^2');
  assert.equal(step('a a a', 'combine-powers', { path: [], start: 0, end: 2 }), 'a^3');
  assert.equal(step('a^2 a^-2', 'combine-powers', { path: [], start: 0, end: 1 }), 'a^0');
  assert.equal(step('a^-1 a^-1', 'combine-powers', { path: [], start: 0, end: 1 }), 'a^-2');
  assert.deepEqual(at('a b', 'combine-powers'), []);
  assert.deepEqual(at('a e', 'combine-powers'), []);
  // Equal but not structurally identical bases do not combine.
  assert.deepEqual(at('a (a^-1)^-1', 'combine-powers'), []);
});

test('combine-powers respects the exponent bound', () => {
  assert.deepEqual(at('a^64 a^64', 'combine-powers'), []);
});

test('zero-power, inverse-of-power and negative-power', () => {
  assert.equal(step('a^0 b', 'zero-power', { path: [], start: 0, end: 0 }), 'e b');
  assert.equal(step('(a^3)^-1', 'inverse-of-power', { path: [], start: 0, end: 0 }), 'a^-3');
  assert.equal(step('a^-3', 'negative-power', { path: [], start: 0, end: 0 }), '(a^3)^-1');
  assert.deepEqual(at('a^3', 'negative-power'), []);
  assert.deepEqual(at('a^-1', 'negative-power'), []);
});

/* Nested targets --------------------------------------------------------- */

test('rules reach inside inverses and powers', () => {
  assert.deepEqual(at('(a a^-1 b)^-1', 'cancel-inverse'), [{ path: [0], start: 0, end: 1 }]);
  assert.equal(step('(a a^-1 b)^-1', 'cancel-inverse', { path: [0], start: 0, end: 1 }), '(e b)^-1');
  assert.deepEqual(at('(a a^-1)^3', 'cancel-inverse'), [{ path: [0], start: 0, end: 1 }]);
  assert.equal(step('(a a^-1)^3', 'cancel-inverse', { path: [0], start: 0, end: 1 }), 'e^3');
});

test('a nested rewrite that collapses a product re-flattens the parent', () => {
  assert.equal(
    step('c (a a^-1 b)^-1', 'cancel-inverse', { path: [1, 0], start: 0, end: 1 }),
    'c (e b)^-1',
  );
  // Reducing the inner product to one factor removes the product node entirely.
  assert.equal(step('c (a b)^-1 d', 'inverse-of-product', { path: [], start: 1, end: 1 }), 'c b^-1 a^-1 d');
});

test('the same rewrite at different depths gives different results', () => {
  assert.equal(step('a a^-1 (a a^-1)^-1', 'cancel-inverse', { path: [], start: 0, end: 1 }), 'e (a a^-1)^-1');
  assert.equal(step('a a^-1 (a a^-1)^-1', 'cancel-inverse', { path: [2, 0], start: 0, end: 1 }), 'a a^-1 e^-1');
});

/* Target validation ------------------------------------------------------ */

test('a target the rule does not offer is rejected', () => {
  const term = parseTerm('a a^-1 b');
  assert.throws(() => applyRule(term, 'cancel-inverse', { path: [], start: 1, end: 2 }), /does not apply/);
  assert.throws(() => applyRule(term, 'cancel-inverse', { path: [], start: 0, end: -1 }), /applies to factors/);
  assert.throws(
    () => applyRule(term, 'insert-identity', { path: [], start: 0, end: 0 }),
    /applies between factors/,
  );
});

test('malformed targets are rejected before any rewrite', () => {
  const term = parseTerm('a a^-1 b');
  const bad: unknown[] = [
    null,
    'nope',
    { path: [], start: -1, end: 1 },
    { path: [], start: 0, end: 9 },
    { path: [], start: 0.5, end: 1 },
    { path: [], start: 0, end: Number.NaN },
    { path: [0, 0, 0], start: 0, end: 0 },
    { path: ['x'], start: 0, end: 0 },
    { path: [-1], start: 0, end: 0 },
    { start: 0, end: 1 },
  ];
  for (const target of bad) {
    assert.throws(
      () => applyRule(term, 'cancel-inverse', target),
      RangeError,
      `expected ${JSON.stringify(target)} to be rejected`,
    );
  }
});

test('applying a rule does not mutate the term it was given', () => {
  const term = parseTerm('a a^-1 b');
  const snapshot = JSON.parse(JSON.stringify(term));
  applyRule(term, 'cancel-inverse', { path: [], start: 0, end: 1 });
  assert.deepEqual(term, snapshot);
});

test('details are plain words, never TeX', () => {
  const samples: [string, RuleId, Target][] = [
    ['a a^-1', 'cancel-inverse', { path: [], start: 0, end: 1 }],
    ['a e', 'remove-identity', { path: [], start: 1, end: 1 }],
    ['(ab)^-1', 'inverse-of-product', { path: [], start: 0, end: 0 }],
    ['a^-3', 'expand-power', { path: [], start: 0, end: 0 }],
    ['a^3 a^-2', 'combine-powers', { path: [], start: 0, end: 1 }],
    ['(a^-1)^-1', 'double-inverse', { path: [], start: 0, end: 0 }],
  ];
  for (const [text, rule, target] of samples) {
    const { detail, reason } = applyRule(parseTerm(text), rule, target);
    assert.doesNotMatch(detail, /[\\^{}]/, `${rule} detail leaked TeX: ${detail}`);
    assert.doesNotMatch(reason, /[\\^{}]/, `${rule} reason leaked TeX: ${reason}`);
  }
});

/* ------------------------------------------------------------------ */
/* Cancelling across a run                                             */
/* ------------------------------------------------------------------ */

/**
 * Products are stored flat, so `(ab)^{-1}(ab)` is on the line as the three
 * factors `(ab)^{-1}`, `a`, `b`. Cancelling has to see that as an instance of
 * `x^{-1}x` — otherwise the storage format would be silently forbidding a
 * proof, and the whole point of flattening is that associative rebracketing is
 * free and never costs a step. Without this, socks-and-shoes cannot be derived
 * from the axioms at all.
 */
test('cancelling matches a factor against the run it inverts', () => {
  for (const source of ['(a b)^-1 a b', 'a b (a b)^-1', '(a b c)^-1 a b c', 'a b c (a b c)^-1']) {
    const term = parseTerm(source);
    const found = findTargets(term, 'cancel-inverse');
    assert.equal(found.length, 1, `${source}: expected exactly one place, got ${found.length}`);
    assert.equal(
      termSource(applyRule(term, 'cancel-inverse', found[0]).term),
      'e',
      `${source} should cancel to the identity`,
    );
  }
});

test('cancelling a run leaves everything around it alone', () => {
  const term = parseTerm('c (a b)^-1 a b d');
  const found = findTargets(term, 'cancel-inverse');
  assert.equal(found.length, 1);
  assert.equal(termSource(applyRule(term, 'cancel-inverse', found[0]).term), 'c e d');
});

/**
 * The generalisation must not become "any factors that happen to multiply out
 * to the identity". It is one end of the run inverting exactly the rest, in
 * order — nothing here is allowed to reorder factors or reason about products.
 */
test('cancelling refuses runs that are not one term against its own inverse', () => {
  const cases: [string, number][] = [
    // Right factors, wrong order: the group is not assumed commutative.
    ['(a b)^-1 b a', 3],
    // Only part of what the inverse covers.
    ['(a b)^-1 a', 2],
    // The inverse is not at either end of the run.
    ['a (a b)^-1 b', 3],
    /*
     * This one does equal the identity, and still must not cancel in one move.
     * Seeing that would mean reasoning about products rather than matching a
     * term against its own inverse — the inner pair is there to be cancelled
     * first, and that is the step the learner is meant to take.
     */
    ['b^-1 a^-1 a b', 4],
  ];

  for (const [source, length] of cases) {
    const found = findTargets(parseTerm(source), 'cancel-inverse');
    const wholeLine = found.some((target) => target.start === 0 && target.end === length - 1);
    assert.equal(wholeLine, false, `${source} should not cancel in one move`);
  }
});
