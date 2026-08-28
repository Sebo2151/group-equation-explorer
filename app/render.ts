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

import { SIDES, type Address, type Side, type Subject } from './subject.ts';
import { generatorTex, isGap, pathKey, type Path, type Target, type Term } from './term.ts';

export type TokenKind = 'atom' | 'open' | 'close' | 'script' | 'relation';

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

/* ------------------------------------------------------------------ */
/* Subjects                                                            */
/* ------------------------------------------------------------------ */

/**
 * A whole proof line laid out on one grid.
 *
 * An equation is two term layouts with a relation token between them, sharing a
 * single column run. Each side keeps its own `Layout`, so its node paths and
 * token indices stay local and `targetColumns` needs no notion of sides; the
 * combined position is recovered by shifting.
 *
 * That shift is exact rather than approximate. A token at local index `i` sits
 * in column `2i + 2` and a gap at boundary `b` in column `2b + 1`, so moving a
 * side's tokens along by `offset` moves every column it owns — span and gap
 * alike — by exactly `2 * offset`.
 */
export type SubjectPart = {
  side: Side | null;
  layout: Layout;
  /** Index of this part's first token within the combined token list. */
  offset: number;
};

export type SubjectLayout = {
  tokens: Token[];
  parts: SubjectPart[];
};

export function layoutSubject(subject: Subject): SubjectLayout {
  if (subject.kind === 'expression') {
    const layout = layoutTerm(subject.term);
    return { tokens: layout.tokens, parts: [{ side: null, layout, offset: 0 }] };
  }

  const parts: SubjectPart[] = [];
  const tokens: Token[] = [];

  SIDES.forEach((side) => {
    if (side === 'right') tokens.push({ kind: 'relation', tex: '=' });
    const layout = layoutTerm(side === 'left' ? subject.left : subject.right);
    parts.push({ side, layout, offset: tokens.length });
    tokens.push(...layout.tokens);
  });

  return { tokens, parts };
}

export function subjectColumnCount(layout: SubjectLayout): number {
  return layout.tokens.length * 2 + 1;
}

function partFor(layout: SubjectLayout, side: Side | null): SubjectPart | undefined {
  return layout.parts.find((part) => part.side === side);
}

/**
 * The grid columns an address covers, or `null` when it addresses nothing that
 * is drawn. A whole-equation address covers nothing: it has no target, and
 * under the Phase 3 interface it is offered as a control on the line rather
 * than as a bracket beneath part of it.
 */
export function addressColumns(layout: SubjectLayout, address: Address): Range | null {
  if (address.kind === 'equation') return null;

  const part = partFor(layout, address.kind === 'side' ? address.side : null);
  if (!part) return null;

  const columns = targetColumns(part.layout, address.target);
  if (!columns) return null;

  const shift = 2 * part.offset;
  return [columns[0] + shift, columns[1] + shift];
}

export type AddressPlacement = {
  address: Address;
  columns: Range;
  /** Reading order across the whole line, one-based. */
  ordinal: number;
  /** Which row the control is drawn on; overlapping controls differ. */
  layer: number;
};

/**
 * Place every candidate so that no two controls overlap, numbering them in
 * reading order across the whole line. On an equation that means the left
 * side's candidates are numbered before the right side's, because that is the
 * order the line is read in and the order the digit keys select in.
 */
export function placeAddresses(
  layout: SubjectLayout,
  addresses: Address[],
): AddressPlacement[] {
  const measured = addresses
    .map((address) => ({ address, columns: addressColumns(layout, address) }))
    .filter((entry): entry is { address: Address; columns: Range } => entry.columns !== null)
    .sort(
      (left, right) =>
        left.columns[0] - right.columns[0] ||
        left.columns[1] - right.columns[1] ||
        pathDepth(left.address) - pathDepth(right.address),
    );

  const rowEnds: number[] = [];

  return measured.map((entry, index) => {
    let layer = rowEnds.findIndex((end) => end < entry.columns[0]);
    if (layer === -1) layer = rowEnds.length;
    rowEnds[layer] = entry.columns[1];

    return { ...entry, ordinal: index + 1, layer };
  });
}

function pathDepth(address: Address): number {
  return address.kind === 'equation' ? 0 : address.target.path.length;
}

/** Whether a token is inside the given address, for highlighting. */
export function tokensInAddress(layout: SubjectLayout, address: Address): Set<number> {
  const inside = new Set<number>();
  if (address.kind === 'equation') return inside;

  const columns = addressColumns(layout, address);
  if (!columns || isGap(address.target)) return inside;

  for (let index = 0; index < layout.tokens.length; index += 1) {
    const column = tokenColumn(index);
    if (column >= columns[0] && column <= columns[1]) inside.add(index);
  }
  return inside;
}
