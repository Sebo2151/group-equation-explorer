import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseTerm } from '../app/parse.ts';
import {
  columnCount,
  layoutTerm,
  placeTargets,
  targetColumns,
  tokenColumn,
  tokensInTarget,
} from '../app/render.ts';
import { findTargets } from '../app/rules.ts';
import { pathKey, type Target } from '../app/term.ts';

function tokens(text: string): string[] {
  return layoutTerm(parseTerm(text)).tokens.map((token) => token.tex);
}

test('a flat product is one token per factor', () => {
  assert.deepEqual(tokens('a b c'), ['a', 'b', 'c']);
  assert.deepEqual(tokens('e'), ['e']);
  assert.deepEqual(tokens('r2'), ['r_{2}']);
});

test('a superscript is its own token, so a base and its inverse differ', () => {
  assert.deepEqual(tokens('a^-1'), ['a', '{}^{-1}']);
  assert.deepEqual(tokens('a^3'), ['a', '{}^{3}']);

  const layout = layoutTerm(parseTerm('a^-1'));
  // The `a` inside occupies one token; the whole inverse occupies both.
  assert.deepEqual(layout.nodes.get(pathKey([0]))!.own, [0, 0]);
  assert.deepEqual(layout.nodes.get(pathKey([]))!.own, [0, 1]);
});

test('a compound base is parenthesised, and the parens are tokens', () => {
  assert.deepEqual(tokens('(ab)^-1'), ['(', 'a', 'b', ')', '{}^{-1}']);
  assert.deepEqual(tokens('((ab)^-1 c)^2'), ['(', '(', 'a', 'b', ')', '{}^{-1}', 'c', ')', '{}^{2}']);
});

test('columns are one insertion point either side of every token', () => {
  const layout = layoutTerm(parseTerm('a b'));
  assert.equal(columnCount(layout), 5);
  assert.equal(tokenColumn(0), 2);
  assert.equal(tokenColumn(1), 4);
});

test('a span covers exactly its factors', () => {
  const layout = layoutTerm(parseTerm('a a^-1 b'));
  // Tokens: a | a | ^-1 | b
  assert.deepEqual(targetColumns(layout, { path: [], start: 0, end: 1 }), [
    tokenColumn(0),
    tokenColumn(2),
  ]);
  assert.deepEqual(targetColumns(layout, { path: [], start: 2, end: 2 }), [
    tokenColumn(3),
    tokenColumn(3),
  ]);
});

test('a nested span covers only the nested factors', () => {
  const layout = layoutTerm(parseTerm('c (a a^-1 b)^-1'));
  // Tokens: c | ( | a | a | ^-1 | b | ) | ^-1
  assert.deepEqual(targetColumns(layout, { path: [1, 0], start: 0, end: 1 }), [
    tokenColumn(2),
    tokenColumn(4),
  ]);
});

test('gaps collapse to the insertion column at their boundary', () => {
  const layout = layoutTerm(parseTerm('a b'));
  assert.deepEqual(targetColumns(layout, { path: [], start: 0, end: -1 }), [1, 1]);
  assert.deepEqual(targetColumns(layout, { path: [], start: 1, end: 0 }), [3, 3]);
  assert.deepEqual(targetColumns(layout, { path: [], start: 2, end: 1 }), [5, 5]);
});

test('a target addressing nothing in the layout is dropped, not drawn', () => {
  const layout = layoutTerm(parseTerm('a b'));
  assert.equal(targetColumns(layout, { path: [4], start: 0, end: 0 }), null);
  assert.equal(targetColumns(layout, { path: [], start: 0, end: 5 }), null);
});

/* Placement -------------------------------------------------------------- */

test('overlapping candidates get separate rows, one control each', () => {
  const term = parseTerm('a a^-1 a');
  const targets = findTargets(term, 'cancel-inverse');
  const placements = placeTargets(layoutTerm(term), targets);

  assert.equal(placements.length, targets.length);
  assert.deepEqual(
    placements.map((placement) => placement.ordinal),
    [1, 2],
  );
  assert.notEqual(placements[0].layer, placements[1].layer);
});

test('non-overlapping candidates share one row', () => {
  const term = parseTerm('a a^-1 b c^-1 c');
  const placements = placeTargets(layoutTerm(term), findTargets(term, 'cancel-inverse'));
  assert.deepEqual(
    placements.map((placement) => placement.layer),
    [0, 0],
  );
});

test('two insertion points at the same boundary are still two controls', () => {
  const term = parseTerm('a^-1');
  const placements = placeTargets(layoutTerm(term), findTargets(term, 'insert-identity'));

  // Before the whole inverse, and before the `a` inside it, land on the same
  // column but mean different things.
  const shared = placements.filter((placement) => placement.columns[0] === 1);
  assert.equal(shared.length, 2);
  assert.notEqual(shared[0].layer, shared[1].layer);
});

test('no two controls on one row overlap, for every rule on a nested term', () => {
  const term = parseTerm('(a a^-1 b)^-1 c^2 d');
  const layout = layoutTerm(term);

  for (const rule of ['cancel-inverse', 'insert-identity', 'wrap-double-inverse'] as const) {
    const placements = placeTargets(layout, findTargets(term, rule));
    const rows = new Map<number, [number, number][]>();
    for (const { layer, columns } of placements) {
      const row = rows.get(layer) ?? [];
      for (const other of row) {
        assert.ok(
          columns[1] < other[0] || columns[0] > other[1],
          `${rule}: controls ${JSON.stringify(columns)} and ${JSON.stringify(other)} overlap on row ${layer}`,
        );
      }
      row.push(columns);
      rows.set(layer, row);
    }
  }
});

test('ordinals run left to right across the expression', () => {
  const term = parseTerm('(a a^-1)^-1 b b^-1');
  const placements = placeTargets(layoutTerm(term), findTargets(term, 'cancel-inverse'));
  const starts = placements.map((placement) => placement.columns[0]);
  assert.deepEqual([...starts].sort((left, right) => left - right), starts);
});

/* Highlighting ----------------------------------------------------------- */

test('highlighting covers a span and nothing else', () => {
  const term = parseTerm('a a^-1 b');
  const layout = layoutTerm(term);
  const target: Target = { path: [], start: 0, end: 1 };
  assert.deepEqual([...tokensInTarget(layout, target)].sort(), [0, 1, 2]);
});

test('a gap highlights nothing, because it contains nothing', () => {
  const layout = layoutTerm(parseTerm('a b'));
  assert.equal(tokensInTarget(layout, { path: [], start: 1, end: 0 }).size, 0);
});
