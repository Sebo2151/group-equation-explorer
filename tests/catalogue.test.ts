import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ALL_RULES,
  ALL_RULE_IDS,
  anyRuleById,
  applyToSubject,
  findAddresses,
  isAnyRuleId,
} from '../app/catalogue.ts';
import { EQUATION_RULE_IDS } from '../app/equation-rules.ts';
import { LAW_PURPOSES, purposeFor } from '../app/law-purposes.ts';
import { parseTerm } from '../app/parse.ts';
import { RULE_IDS } from '../app/rules.ts';
import { equation, expression, subjectSource, subjectsEqual } from '../app/subject.ts';
import { findTargets } from '../app/rules.ts';

const term = (source: string) => parseTerm(source);

/* The union ------------------------------------------------------------- */

test('the catalogue is exactly the two tables, with nothing lost or duplicated', () => {
  assert.deepEqual(ALL_RULE_IDS, [...RULE_IDS, ...EQUATION_RULE_IDS]);
  assert.equal(new Set(ALL_RULE_IDS).size, ALL_RULE_IDS.length);
  assert.equal(ALL_RULES.length, RULE_IDS.length + EQUATION_RULE_IDS.length);
});

test('every rule reports the scope that decides how it is offered', () => {
  for (const id of RULE_IDS) assert.equal(anyRuleById(id).scope, 'term');
  for (const id of EQUATION_RULE_IDS) assert.equal(anyRuleById(id).scope, 'equation');
});

test('an unknown rule id is a lookup failure, not a fallthrough', () => {
  assert.equal(isAnyRuleId('cancel-inverse'), true);
  assert.equal(isAnyRuleId('symmetry'), true);
  assert.equal(isAnyRuleId('multiply-by-hope'), false);
  assert.throws(() => anyRuleById('multiply-by-hope' as never), /Unknown rule/);
});

/**
 * Phase 3 permits only equivalences. The `direction` field exists for Phase 6,
 * but until then this is the guarantee that every chain link is reversible.
 */
test('every whole-equation rule in this phase is an equivalence', () => {
  for (const id of EQUATION_RULE_IDS) {
    const definition = anyRuleById(id);
    assert.equal(definition.scope, 'equation');
    assert.equal(definition.scope === 'equation' && definition.direction, 'iff');
  }
});

test('every law appears in exactly one learner-facing purpose group', () => {
  const grouped = LAW_PURPOSES.flatMap((purpose) => purpose.rules);
  assert.deepEqual(new Set(grouped), new Set(ALL_RULE_IDS));
  assert.equal(grouped.length, ALL_RULE_IDS.length);
  for (const id of ALL_RULE_IDS) assert.equal(purposeFor(id).rules.includes(id), true);
});

test('every equivalence formula renders an equivalence command, not the letters iff', () => {
  for (const id of EQUATION_RULE_IDS) {
    assert.match(anyRuleById(id).formula, /\\iff/);
    assert.doesNotMatch(anyRuleById(id).formula, /[^\\]iff/);
  }
});

test('no rule formula or description leaks TeX into a spoken form', () => {
  for (const rule of ALL_RULES) {
    assert.doesNotMatch(rule.spokenFormula, /\\|[{}^]/);
    assert.doesNotMatch(rule.description, /\\|[{}^]/);
  }
});

/* Addressing ------------------------------------------------------------ */

test('an expression yields expression addresses, never sides', () => {
  const subject = expression(term('a a^-1 b'));
  const addresses = findAddresses(subject, 'cancel-inverse');
  assert.equal(addresses.length, 1);
  assert.equal(addresses[0].kind, 'expression');
});

/**
 * The payoff of the Subject/Address split: the same implementation that Phase 2
 * used finds the same targets, addressed to a side.
 */
test('a term rule finds targets on each side of an equation independently', () => {
  const left = term('a a^-1 b');
  const right = term('c c^-1 c c^-1');
  const addresses = findAddresses(equation(left, right), 'cancel-inverse');

  assert.deepEqual(
    addresses.map((address) => (address.kind === 'side' ? address.side : address.kind)),
    ['left', 'right', 'right', 'right'],
  );
  assert.equal(findTargets(left, 'cancel-inverse').length, 1);
  assert.equal(findTargets(right, 'cancel-inverse').length, 3);
});

test('candidates are numbered left to right across the whole line', () => {
  const addresses = findAddresses(equation(term('a a^-1'), term('b b^-1')), 'cancel-inverse');
  const sides = addresses.map((address) => (address.kind === 'side' ? address.side : null));
  assert.deepEqual(sides, ['left', 'right']);
});

test('a whole-equation rule offers exactly one place, and only on an equation', () => {
  assert.deepEqual(findAddresses(equation(term('a x'), term('b')), 'symmetry'), [
    { kind: 'equation' },
  ]);
  assert.deepEqual(findAddresses(expression(term('a x')), 'symmetry'), []);
});

/* Applying -------------------------------------------------------------- */

test('a local rewrite changes one side and leaves the other alone', () => {
  const subject = equation(term('a a^-1 b'), term('c c^-1'));
  const [address] = findAddresses(subject, 'cancel-inverse');
  const result = applyToSubject(subject, 'cancel-inverse', address);

  assert.equal(subjectSource(result.subject), 'e b = c c^-1');
  assert.equal(result.address.kind, 'side');
  // The untouched side is still exactly what it was.
  assert.equal(subjectSource(subject), 'a a^-1 b = c c^-1');
});

test('the recorded detail names the side the rewrite happened on', () => {
  const subject = equation(term('a'), term('b b^-1'));
  const [address] = findAddresses(subject, 'cancel-inverse');
  const result = applyToSubject(subject, 'cancel-inverse', address);

  assert.match(result.detail, /^on the right, /);
  assert.doesNotMatch(result.detail, /\\|[{}^]/);
});

test('symmetry swaps the sides and nothing else', () => {
  const subject = equation(term('a x'), term('b'));
  const result = applyToSubject(subject, 'symmetry', { kind: 'equation' });

  assert.equal(subjectSource(result.subject), 'b = a x');
  assert.equal(result.reason, 'Symmetry');
  assert.doesNotMatch(result.detail, /\\|[{}^]/);
});

test('symmetry applied twice returns the original equation', () => {
  const subject = equation(term('a x'), term('b'));
  const once = applyToSubject(subject, 'symmetry', { kind: 'equation' }).subject;
  const twice = applyToSubject(once, 'symmetry', { kind: 'equation' }).subject;
  assert.equal(subjectsEqual(twice, subject), true);
});

test('applying a rule does not mutate the subject it was given', () => {
  const subject = equation(term('a a^-1 b'), term('c'));
  const snapshot = structuredClone(subject);
  const [address] = findAddresses(subject, 'cancel-inverse');
  applyToSubject(subject, 'cancel-inverse', address);
  assert.deepEqual(subject, snapshot);
});

/* Mismatches ------------------------------------------------------------ */

test('a whole-equation rule cannot be aimed at an expression', () => {
  assert.throws(
    () => applyToSubject(expression(term('a x')), 'symmetry', { kind: 'equation' }),
    /needs an equation/,
  );
});

test('a whole-equation rule cannot be aimed at a span', () => {
  assert.throws(
    () =>
      applyToSubject(equation(term('a x'), term('b')), 'symmetry', {
        kind: 'side',
        side: 'left',
        target: { path: [], start: 0, end: 0 },
      }),
    /applies to the whole equation/,
  );
});

test('a term rule cannot be aimed at the whole equation', () => {
  assert.throws(
    () => applyToSubject(equation(term('a a^-1'), term('b')), 'cancel-inverse', { kind: 'equation' }),
    /not to the whole equation/,
  );
});

test('a side address is meaningless on an expression, and vice versa', () => {
  assert.throws(
    () =>
      applyToSubject(expression(term('a a^-1')), 'cancel-inverse', {
        kind: 'side',
        side: 'left',
        target: { path: [], start: 0, end: 1 },
      }),
    /no sides/,
  );
  assert.throws(
    () =>
      applyToSubject(equation(term('a a^-1'), term('b')), 'cancel-inverse', {
        kind: 'expression',
        target: { path: [], start: 0, end: 1 },
      }),
    /needs a side/,
  );
});

test('malformed addresses are rejected before any rewrite', () => {
  const subject = equation(term('a a^-1'), term('b'));
  assert.throws(() => applyToSubject(subject, 'cancel-inverse', null), /Address must be an object/);
  assert.throws(
    () => applyToSubject(subject, 'cancel-inverse', { kind: 'middle' }),
    /Unknown address kind/,
  );
  assert.throws(
    () =>
      applyToSubject(subject, 'cancel-inverse', {
        kind: 'side',
        side: 'sideways',
        target: { path: [], start: 0, end: 1 },
      }),
    /side must be/,
  );
});

test('a target the rule does not offer is refused on either side', () => {
  const subject = equation(term('a b'), term('c'));
  assert.throws(
    () =>
      applyToSubject(subject, 'cancel-inverse', {
        kind: 'side',
        side: 'left',
        target: { path: [], start: 0, end: 1 },
      }),
    /does not apply there/,
  );
});

/* Every term rule still works, addressed to a side ---------------------- */

/**
 * The claim that Phase 3 adds equations without touching `rules.ts`. For each
 * term rule, a line on which it applies is rewritten on the right-hand side of
 * an equation, and the left side must come through untouched.
 */
test('every term rule that applies to a term also applies to that term as a side', () => {
  const samples: Record<string, string> = {
    'cancel-inverse': 'a a^-1',
    'insert-inverse-pair': 'b',
    'remove-identity': 'e b',
    'insert-identity': 'b',
    'double-inverse': '(a^-1)^-1',
    'wrap-double-inverse': 'a',
    'inverse-of-product': '(a b)^-1',
    'combine-inverses': 'b^-1 a^-1',
    'inverse-of-identity': 'e^-1',
    'expand-power': 'a^3',
    'combine-powers': 'a^2 a^3',
    'zero-power': 'a^0',
    'inverse-of-power': '(a^2)^-1',
    'negative-power': 'a^-2',
  };

  // Nothing may be added to or dropped from the catalogue without a sample.
  assert.deepEqual(Object.keys(samples).sort(), [...RULE_IDS].sort());

  const untouched = term('z');
  for (const [rule, source] of Object.entries(samples)) {
    const subject = equation(untouched, term(source));
    // Insertion rules mark gaps on both sides, so the right-hand one is chosen
    // rather than assumed to be first.
    const address = findAddresses(subject, rule as never).find(
      (candidate) => candidate.kind === 'side' && candidate.side === 'right',
    );
    assert.ok(address, `${rule} found no target on the right side of an equation`);

    const argument = anyRuleById(rule as never).needsTerm ? { term: term('a') } : undefined;
    const result = applyToSubject(subject, rule as never, address, argument);

    assert.equal(result.subject.kind, 'equation');
    assert.deepEqual(
      result.subject.kind === 'equation' ? result.subject.left : null,
      untouched,
      `${rule} disturbed the other side`,
    );
  }
});
