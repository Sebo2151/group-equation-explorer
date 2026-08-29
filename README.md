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
- [Phase 4 record](docs/phase-4-2026-08-28.md) — the curriculum, the unlock and
  hint designs, why one rule had to widen, and what was left undone.

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

## Phase 4

The challenges are now a course rather than a list. They unlock in order, each
one opening when the one before it is proved, and what a learner earns along the
way is *laws*: `(a^-1)^-1 = a`, socks-and-shoes, `e^-1 = e` and cancellation are
each proved in a challenge of their own before any later challenge is allowed to
use them in a single step. A test walks the whole list and fails if a derived
law is ever offered before the challenge that establishes it, or if a challenge
is handed the law it exists to prove.

Making socks-and-shoes provable meant widening one rule. Deriving it from the
axioms requires writing `(ab)^-1(ab)` and cancelling — but products are flat, so
that line holds three factors and "cancel inverse pair" only matched two. It now
matches a factor against the adjacent run it inverts, which removes a limitation
of the storage format rather than granting a new law: associative rebracketing
is free here and was never meant to cost a step.

Solving for x is now a goal *shape* — x by itself on a named side, and gone from
the other — so any route that solves the equation finishes it. Exact goals are
unchanged, and still orientation sensitive.

Hints come in three grades, from the family of laws to look in, through the law
and where it applies, to the move itself offered as a control. They walk a
reference proof that ships with each challenge and is machine-checked against
exactly that challenge's tools. There is no proof search, so a learner who has
gone a different way is told exactly that — their line is not wrong, it is
simply not on the route the app knows — and offered the route, or a step back
onto it.

Progress is kept on the device as the proofs themselves. That is what makes it
evidence: reading it back replays every record against the same rule contracts
the interface uses, and drops anything that does not check out, including a real
proof relabelled with a shorter step count. A completion can be claimed in
storage, but it cannot be bought there.

The twenty-one challenges are grouped into five named chapters, each with a
learning outcome. The inverse chapter now proves separately that a right inverse
and a left inverse must equal the named inverse before using uniqueness to
identify the inverse of the identity. Later practice reinforces powers, mixed
inverses, and solving equations with factors on both ends. Every challenge opens
with a focused briefing and closes with a takeaway and a clear next step. The
briefing presents the starting point, target, and prediction prompt before the
proof controls appear. Once work begins, the goal stays compact and the laws are
grouped by what they accomplish. No law is selected initially: identifying the
appropriate tool is part of the proof. The menu leads with the learner's next
useful action, shows overall progress, and keeps the full course map available
chapter by chapter.

## The shell

The app opens on a menu: the challenges in order, a form for starting from an
expression of your own, a box for replaying a proof someone shared, and general
help. The proof screen then carries only the proof, the laws, the controls that
act on the proof, and a way back — everything else is a thing you do before a
proof rather than during one.

Navigation is by URL fragment, not by route: `#challenge=solve-left`, `#free`,
`#help`, and the `#proof=…` that sharing already used. A challenge is therefore
linkable and the back button works, without a router and without committing the
static-hosting question to anything.

## Phase 3

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

The whole-equation laws are symmetry, left and right multiplication, and
inverting both sides. Left and right multiplication are separate laws rather
than one law with a direction argument: the group is not assumed abelian, so
`wu = wv` and `uw = vw` are different statements, and a recorded step or a
spoken name should say which was used without a flag read alongside it.

Every whole-equation law declares a `direction`, and a test asserts that every
one of them in this phase is an equivalence. The field exists now so that the
one-way inference of Phase 6 does not need a record migration to gain it.

Cancellation is deliberately **not** a primitive law. It is derivable from left
multiplication and the local laws, so a challenge is where it gets proved. Phase
4 is what grants it as a tool afterwards.

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

No implication mode, custom relations or presentations, unlock system, hints,
progress storage, or personal bests. Those are Phases 4 to 6. Goals are exact
equations; a "solve for x" goal expressed as a shape rather than one particular
equation is wanted, but not yet built.

Note that a proof chain is still a chain of equivalences. Establishing that one
statement *follows from* another without the converse is Phase 6, and no law in
the catalogue can express it.

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

Soundness of the rules is checked by evaluation as well as by structure. Every
law is applied to sample terms and the result compared, over every assignment of
generators to elements, in S3 and D4 — both non-abelian, which is the point. A
rule that quietly assumed commutativity would be structurally impeccable and
would fail there immediately. Note what this cannot see: left and right
multiplication are *both* sound, so only the shape of the result distinguishes
them, and that is asserted separately.

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
- `app/challenges.ts` — the curriculum: each challenge's ruleset, the law it
  earns, what unlocks it, and the reference proof the hints walk
- `app/goal.ts` — what a challenge asks you to reach: an exact line, or a
  variable standing alone on a named side
- `app/progress.ts` — what the device remembers, as proofs rather than flags,
  and the unlocks and personal bests derived from them
- `app/storage.ts` — the one place the app touches browser storage
- `app/hints.ts` — graduated hints from the authored route, and the honest
  answer when the learner has gone somewhere else
- `app/navigation.ts` — where the app is, encoded in the URL fragment
- `app/proof.ts` — proof history as a DOM-free reducer, plus the replay verifier
- `app/serialize.ts` — proof record export/import, LaTeX export, share links
- `app/render.ts` — laying a line out as grid columns so brackets can span it;
  an equation is two term layouts either side of a relation token, sharing one
  column run
- `app/page.tsx` — React interaction and typesetting
- `app/globals.css` — visual system and responsive layout
- `tests/support/finite-group.ts` — evaluating a term in a concrete finite
  group, used to check that no rule has quietly assumed commutativity
- `tests/*.test.ts` — Node tests for each module above
- `tests/browser/*.spec.ts` — Playwright interaction invariants

The mathematical interaction runs in the browser and uses no database or backend
solver. The current React/Vinext/Sites scaffold still requires a build and web
server; offline standalone operation and static GitHub Pages export are not yet
implemented or verified.
