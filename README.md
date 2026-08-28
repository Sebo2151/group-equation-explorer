# Group Equation Explorer

An interactive proof workbench for learning how group axioms transform expressions, one justified step at a time.

## Development and audit context

Start here when reviewing the code with fresh context:

- [Development plan](docs/development-plan.md) — product intent, mathematical
  model, interaction design, six-phase roadmap, and acceptance criteria.
- [Audit handoff](docs/audit-handoff.md) — implementation status, test evidence,
  known limitations, review priorities, and a suggested audit prompt.
- [Audit record, 2026-08-27](docs/audit-2026-08-27.md) — the first audit pass:
  defects reproduced and fixed, security posture, and what remains untested.

## Phase 2

The app is now a recursive expression workbench. Expressions are terms —
generators, the identity, flat products, inverses, and integer powers — rather
than a flat list of factors, and they can be typed rather than only chosen from.

Selecting a group law marks every legal target with its own bracket beneath the
expression; overlapping targets, and insertion points that coincide on screen at
different depths, get separate brackets, so no two candidates ever share a
control. Applying a law appends the resulting expression and its reason to an
equality chain.

What Phase 2 added on top of the Phase 1 slice:

- a recursive term model with paths and spans, so a rule can address the `ab`
  inside `(ab)^-1 a b` without any manual regrouping;
- a restricted parser with live typeset feedback, and a canonical serializer
  that round trips;
- integer powers kept as notation, with rules to write them out, combine them,
  and move an inverse through them;
- insertion rules — the learner names the term, then picks the gap — and the
  reverse direction of the structural rewrites;
- six curated challenges, each declaring the rules it permits, plus a free
  exploration mode with the whole catalogue;
- export as a structured proof record or as LaTeX, a shareable link, and an
  import that replays every step against the same rule contracts before showing
  anything;
- keyboard navigation across candidates (arrows, digits) and undo/redo.

Associativity is still suppressed in the interface: products are flat, so
students do not spend their time rearranging parentheses. Structure under an
inverse or a power is kept, because that structure is mathematically meaningful.

## Phase 3a

A proof line can now be an *equation* as well as an expression. A chain of
expressions is joined by `=`; a chain of equations by `⟺`, because each line is
a statement rather than a quantity.

The model change is one level above the term: a line is a `Subject`, either an
expression or an equation, and `Term` is untouched. An equation is not a term —
it cannot sit under an inverse or be a factor in a product — so making it one
would have forced every rule to guard a case that is never legal. Keeping `Term`
closed is what lets all fourteen existing laws apply to one side of an equation
without a line of rule logic being added.

Two kinds of move are therefore possible on an equation, and the interface keeps
them apart:

- a **local rewrite** uses one of the existing laws on a sub-expression inside
  one side, and marks its targets with brackets beneath the line exactly as it
  always has. Candidates are numbered in reading order across the whole line,
  left side before right, and each announces which side it is on — without that,
  the two halves of `a a^-1 = a a^-1` would offer indistinguishable controls;
- a **whole-equation law** transforms the statement itself. It has no target and
  no place to be chosen among, so it is offered as a named control on the line
  rather than as a bracket under part of it. `symmetry` is the first of these.

Every whole-equation law declares a `direction`, and a test asserts that every
one of them in this phase is an equivalence. The field exists now so that the
one-way inference of Phase 6 does not need a record migration to gain it.

Goal matching is orientation sensitive: reaching `v = u` when the goal is
`u = v` leaves symmetry still to be applied. Making the two equal would hand out
the step and remove the only reason symmetry is ever exercised.

### Notation

Products are written by juxtaposition, with `*` and `·` accepted as optional
separators:

```text
ab          a b          a*b
(ab)^-1 c   a^3          a^-2        (a^2)^3
r2 s        e
a x = b     (a b)^-1 = b^-1 a^-1
```

A single `=` makes the line an equation. The relation is recognised outside the
term grammar, so it cannot appear inside parentheses, under an inverse, or in an
exponent; a line with two of them is refused. In free exploration the start and
the goal must agree about being equations — an equation is not provably equal to
an expression.

A generator is one letter followed by any digits, so `r2` is a generator and
`a^2` is a power; juxtaposition is never ambiguous. `e` is the identity and may
not name a generator. `a^1` and `a^-1` are notation for the term and its
inverse, not extra structure. Repeated powers need parentheses. Input is length,
depth, exponent, and node limited, and is never evaluated.

Free exploration keeps its draft and last started proof when switching to a
challenge and back, including unfinished or invalid draft text. Press **Start**
to replace that proof with the edited expression. While typing in a field,
Ctrl/Cmd+Z and redo edit the text; outside fields, they navigate proof history.

### Rules and challenges

Every rule in the catalogue is a theorem of any group. Whether a *challenge* may
use it is separate: each challenge names its permitted rules, and that ruleset
travels with the proof. A challenge that establishes a lemma must not list that
lemma among its tools, and an imported proof claiming a challenge is rejected if
it used tools that challenge forbids.

Imports preserve the recorded ruleset for free and unknown challenges too.
Editor input is limited to 240 characters; serialized expressions may use the
20,000-character record budget because canonical notation adds spaces. The
grammar, structural limits, and maximum generator-name length remain enforced.
JSON export uses compact formatting when needed to fit that same record budget,
and refuses records that still cannot be reopened. LaTeX remains available for
longer proofs.

### What is still not implemented

The whole-equation catalogue holds only `symmetry` so far. Left and right
multiplication, inverting both sides, and the equation-solving challenges are
Phase 3b, along with a finite-group evaluator to catch any rule that has
quietly assumed commutativity.

No implication mode, custom relations or presentations, unlock system, hints,
progress storage, or personal bests. Those are Phases 4 to 6. Cancellation will
be a challenge rather than a built-in law: it is derivable, and proving it
before using it is the point.

## Run locally

Install dependencies and start the development server:

```bash
npm install
npm run dev
```

Then open the local address printed by the server.

For a phone on the same local network, bind the server to the network interfaces:

```bash
npm run dev -- --hostname 0.0.0.0
```

Use the LAN address printed by the server; do not assume an old address is still
current. Firewall access may need to be allowed for the private network.

## Validate

```bash
npm test
npm run lint
npx tsc --noEmit --incremental false
npm run build
npm run test:browser
```

`npm run test:browser` runs the Playwright suites in `tests/browser`, against a
desktop viewport and a genuine 390px phone profile. It asserts behavioural
invariants — focus destinations, dock-versus-active-line geometry, one control
per candidate, no TeX in accessible names — rather than appearance, so it should
survive a redesign. First run needs `npx playwright install chromium`.

No real-device trial has been run yet; screen reader, zoom, and enlarged-text
passes also remain open. See the audit record for the current gaps.

## Project shape

- `app/term.ts` — the recursive term model: construction with associative
  flattening, structural equality, paths, spans and gaps, validation, and the
  TeX, spoken, and source renderings
- `app/subject.ts` — what a proof line is about: an expression or an equation,
  plus the address that says where on the line a law was used
- `app/parse.ts` — the restricted parser and its error reporting
- `app/rules.ts` — the term rule catalogue: matching and rewriting defined
  together, one entry per rule
- `app/equation-rules.ts` — laws that act on a line as a whole, each declaring
  whether its converse also holds
- `app/catalogue.ts` — the two catalogues as one id space, and the dispatch that
  applies a term rule to one side of an equation
- `app/challenges.ts` — challenge data, including each challenge's ruleset
- `app/proof.ts` — proof history as a DOM-free reducer, plus the replay verifier
- `app/serialize.ts` — proof record export/import, LaTeX export, share links
- `app/render.ts` — laying a line out as grid columns so brackets can span it;
  an equation is two term layouts either side of a relation token, sharing one
  column run
- `app/page.tsx` — React interaction and typesetting
- `app/globals.css` — visual system and responsive layout
- `tests/*.test.ts` — Node tests for each module above
- `tests/browser/*.spec.ts` — Playwright interaction invariants

The mathematical interaction runs in the browser and uses no database or backend
solver. The current React/Vinext/Sites scaffold still requires a build and web
server; offline standalone operation and static GitHub Pages export are not yet
implemented or verified.
