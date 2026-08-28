/**
 * Laying a term out as a row of tokens.
 *
 * The expression and every candidate control share one CSS grid, so a bracket
 * can span exactly the columns of the sub-expression it applies to without any
 * measurement JavaScript. This module decides what the columns are.
 *
 * Grid columns alternate: an insertion point, a token, an insertion point, and
 * so on. Token `i` sits in grid column `2i + 2`; the gap before token `i` is
 * grid column `2i + 1`. That gives a zero-width insertion control somewhere to
 * live without disturbing the spacing of the mathematics.
 */

import { generatorTex, isGap, pathKey, type Path, type Target, type Term } from './term.ts';

export type TokenKind = 'atom' | 'open' | 'close' | 'script';

export type Token = {
  kind: TokenKind;
  /** Self-contained TeX for this token alone. */
  tex: string;
};

export type Range = [first: number, last: number];

export type Layout = {
  tokens: Token[];
  /**
   * Per node path: the tokens the node itself occupies, and the token ranges
   * of the factors a target's span indexes into.
   */
  nodes: Map<string, { own: Range; hostRanges: Range[] }>;
};

/**
 * Superscripts ride on an empty base so they can be their own column. A
 * superscript glued to its base would make the base and the whole
 * inverse — two different targets — cover identical columns.
 */
function scriptTex(exponent: number): string {
  return `{}^{${exponent}}`;
}

export function layoutTerm(term: Term): Layout {
  const tokens: Token[] = [];
  const nodes = new Map<string, { own: Range; hostRanges: Range[] }>();

  const emit = (kind: TokenKind, tex: string): number => {
    tokens.push({ kind, tex });
    return tokens.length - 1;
  };

  const visit = (node: Term, path: Path): Range => {
    let own: Range;
    let hostRanges: Range[];

    switch (node.kind) {
      case 'generator': {
        const index = emit('atom', generatorTex(node.name));
        own = [index, index];
        hostRanges = [own];
        break;
      }
      case 'identity': {
        const index = emit('atom', 'e');
        own = [index, index];
        hostRanges = [own];
        break;
      }
      case 'product': {
        hostRanges = node.factors.map((factor, index) => visit(factor, [...path, index]));
        own = [hostRanges[0][0], hostRanges[hostRanges.length - 1][1]];
        break;
      }
      case 'inverse':
      case 'power': {
        const child = node.kind === 'inverse' ? node.term : node.base;
        const exponent = node.kind === 'inverse' ? -1 : node.exponent;
        const bare = child.kind === 'generator' || child.kind === 'identity';

        const first = bare ? tokens.length : emit('open', '(');
        visit(child, [...path, 0]);
        if (!bare) emit('close', ')');
        const last = emit('script', scriptTex(exponent));

        own = [first, last];
        hostRanges = [own];
        break;
      }
    }

    nodes.set(pathKey(path), { own, hostRanges });
    return own;
  };

  visit(term, []);
  return { tokens, nodes };
}

/** Total grid columns: one insertion point either side of every token. */
export function columnCount(layout: Layout): number {
  return layout.tokens.length * 2 + 1;
}

export function tokenColumn(index: number): number {
  return index * 2 + 2;
}

export function gapColumn(boundary: number): number {
  return boundary * 2 + 1;
}

/**
 * The grid columns a target covers, as a closed interval. A gap collapses to
 * the single insertion column at its boundary.
 */
export function targetColumns(layout: Layout, target: Target): Range | null {
  const node = layout.nodes.get(pathKey(target.path));
  if (!node) return null;
  const { hostRanges } = node;

  if (isGap(target)) {
    if (target.start < 0 || target.start > hostRanges.length) return null;
    const boundary =
      target.start < hostRanges.length
        ? hostRanges[target.start][0]
        : hostRanges[hostRanges.length - 1][1] + 1;
    return [gapColumn(boundary), gapColumn(boundary)];
  }

  if (target.start < 0 || target.end >= hostRanges.length) return null;
  return [tokenColumn(hostRanges[target.start][0]), tokenColumn(hostRanges[target.end][1])];
}

export type Placement = {
  target: Target;
  columns: Range;
  /** Reading order across the expression, one-based. */
  ordinal: number;
  /** Which row the control is drawn on; overlapping controls differ. */
  layer: number;
};

/**
 * Place every candidate so that no two controls overlap. Overlapping targets —
 * the two pairs in `a a^-1 a`, or two insertion points that fall at the same
 * boundary at different depths — are pushed onto separate rows, so there is
 * always exactly one control per candidate and never a shared one.
 */
export function placeTargets(layout: Layout, targets: Target[]): Placement[] {
  const measured = targets
    .map((target) => ({ target, columns: targetColumns(layout, target) }))
    .filter((entry): entry is { target: Target; columns: Range } => entry.columns !== null)
    .sort(
      (left, right) =>
        left.columns[0] - right.columns[0] ||
        left.columns[1] - right.columns[1] ||
        left.target.path.length - right.target.path.length,
    );

  const rowEnds: number[] = [];

  return measured.map((entry, index) => {
    let layer = rowEnds.findIndex((end) => end < entry.columns[0]);
    if (layer === -1) layer = rowEnds.length;
    rowEnds[layer] = entry.columns[1];

    return { ...entry, ordinal: index + 1, layer };
  });
}

/** Whether a token is inside any of the given targets, for highlighting. */
export function tokensInTarget(layout: Layout, target: Target): Set<number> {
  const inside = new Set<number>();
  const columns = targetColumns(layout, target);
  if (!columns || isGap(target)) return inside;

  for (let index = 0; index < layout.tokens.length; index += 1) {
    const column = tokenColumn(index);
    if (column >= columns[0] && column <= columns[1]) inside.add(index);
  }
  return inside;
}
