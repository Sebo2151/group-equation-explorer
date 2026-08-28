import assert from 'node:assert/strict';
import { test } from 'node:test';

import { findAddresses } from '../app/catalogue.ts';
import { parseTerm } from '../app/parse.ts';
import {
  addressColumns,
  layoutSubject,
  layoutTerm,
  placeAddresses,
  subjectColumnCount,
  targetColumns,
  tokensInAddress,
} from '../app/render.ts';
import { equation, expression, type Address } from '../app/subject.ts';

const term = (source: string) => parseTerm(source);

const side = (which: 'left' | 'right', start: number, end: number, path: number[] = []): Address => ({
  kind: 'side',
  side: which,
  target: { path, start, end },
});

/* Shape ----------------------------------------------------------------- */

test('an expression lays out as one part, exactly as it did before', () => {
  const layout = layoutSubject(expression(term('a b')));
  assert.equal(layout.parts.length, 1);
  assert.equal(layout.parts[0].side, null);
  assert.equal(layout.parts[0].offset, 0);
  assert.deepEqual(layout.tokens, layoutTerm(term('a b')).tokens);
});

test('an equation lays out as left, relation, right', () => {
  const layout = layoutSubject(equation(term('a x'), term('b')));
  assert.deepEqual(
    layout.tokens.map((token) => token.kind),
    ['atom', 'atom', 'relation', 'atom'],
  );
  assert.deepEqual(
    layout.tokens.map((token) => token.tex),
    ['a', 'x', '=', 'b'],
  );
});

test('the relation is one token, so the sides never share a column', () => {
  const layout = layoutSubject(equation(term('a'), term('b')));
  assert.equal(layout.parts[0].offset, 0);
  // left token, then the relation, so the right side starts at index 2.
  assert.equal(layout.parts[1].offset, 2);
  assert.equal(subjectColumnCount(layout), 3 * 2 + 1);
});

/* Column arithmetic ------------------------------------------------------ */

/**
 * The claim the whole subject layout rests on: a side's columns are its own
 * columns shifted by twice its token offset, for spans and gaps alike.
 */
test('a side target lands on its own columns shifted by twice the offset', () => {
  const left = term('a a^-1 b');
  const right = term('c c^-1');
  const layout = layoutSubject(equation(left, right));
  const rightPart = layout.parts[1];
  const shift = 2 * rightPart.offset;

  const span = { path: [], start: 0, end: 1 };
  assert.deepEqual(addressColumns(layout, side('right', 0, 1)), [
    targetColumns(layoutTerm(right), span)![0] + shift,
    targetColumns(layoutTerm(right), span)![1] + shift,
  ]);

  const gap = { path: [], start: 1, end: 0 };
  assert.deepEqual(addressColumns(layout, side('right', 1, 0)), [
    targetColumns(layoutTerm(right), gap)![0] + shift,
    targetColumns(layoutTerm(right), gap)![1] + shift,
  ]);

  // The left side is unshifted, so it is unchanged from the bare term.
  assert.deepEqual(
    addressColumns(layout, side('left', 0, 1)),
    targetColumns(layoutTerm(left), { path: [], start: 0, end: 1 }),
  );
});

test('a whole-equation address covers no columns, because it is not a bracket', () => {
  const layout = layoutSubject(equation(term('a x'), term('b')));
  assert.equal(addressColumns(layout, { kind: 'equation' }), null);
  assert.equal(tokensInAddress(layout, { kind: 'equation' }).size, 0);
});

test('an address naming a side the line does not have is dropped, not drawn', () => {
  const layout = layoutSubject(expression(term('a b')));
  assert.equal(addressColumns(layout, side('left', 0, 0)), null);
});

/* Highlighting ----------------------------------------------------------- */

test('highlighting a span on the right covers only that side', () => {
  const layout = layoutSubject(equation(term('a b'), term('c d')));
  // Right side tokens are indices 3 and 4; the relation is index 2.
  assert.deepEqual([...tokensInAddress(layout, side('right', 0, 1))].sort(), [3, 4]);
  assert.deepEqual([...tokensInAddress(layout, side('left', 0, 1))].sort(), [0, 1]);
});

test('the relation is never inside a highlight', () => {
  const layout = layoutSubject(equation(term('a'), term('b')));
  for (const address of [side('left', 0, 0), side('right', 0, 0)]) {
    assert.equal(tokensInAddress(layout, address).has(1), false);
  }
});

/* Ordinals and placement ------------------------------------------------- */

test('candidates are numbered left to right across the whole line', () => {
  const subject = equation(term('a a^-1'), term('b b^-1'));
  const layout = layoutSubject(subject);
  const placements = placeAddresses(layout, findAddresses(subject, 'cancel-inverse'));

  assert.deepEqual(
    placements.map((placement) => ({
      ordinal: placement.ordinal,
      side: placement.address.kind === 'side' ? placement.address.side : null,
    })),
    [
      { ordinal: 1, side: 'left' },
      { ordinal: 2, side: 'right' },
    ],
  );
});

test('no two controls on one row overlap, across both sides', () => {
  const subject = equation(term('a a^-1 a'), term('b b^-1 b'));
  const layout = layoutSubject(subject);
  const placements = placeAddresses(layout, findAddresses(subject, 'cancel-inverse'));

  assert.ok(placements.length >= 4, 'expected overlapping pairs on both sides');

  const byRow = new Map<number, [number, number][]>();
  for (const { layer, columns } of placements) {
    byRow.set(layer, [...(byRow.get(layer) ?? []), columns]);
  }
  for (const row of byRow.values()) {
    const sorted = [...row].sort((left, right) => left[0] - right[0]);
    for (let index = 1; index < sorted.length; index += 1) {
      assert.ok(
        sorted[index][0] > sorted[index - 1][1],
        `controls overlap on one row: ${JSON.stringify(sorted)}`,
      );
    }
  }
});

test('a whole-equation address is not placed as a bracket at all', () => {
  const subject = equation(term('a x'), term('b'));
  const layout = layoutSubject(subject);
  assert.deepEqual(placeAddresses(layout, findAddresses(subject, 'symmetry')), []);
});

test('insertion gaps on both sides stay distinct controls', () => {
  const subject = equation(term('a'), term('b'));
  const layout = layoutSubject(subject);
  const placements = placeAddresses(layout, findAddresses(subject, 'insert-identity'));

  const columns = placements.map((placement) => placement.columns.join('-'));
  assert.equal(new Set(columns).size, columns.length, 'two gaps shared a column');
});
