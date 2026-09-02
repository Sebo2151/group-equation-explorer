# Design notes

How the app came to work the way it does, kept in the order the pieces were
built. This is background for someone reading or extending the code; a student
needs none of it, and the [README](../README.md) is written for them instead.

The roadmap these phases belong to is in the
[development plan](development-plan.md).

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

Hints come in three grades, from the palette category to look in, through the law
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

The twenty-six challenges are grouped into five named chapters, each with a
learning outcome. The inverse chapter now proves separately that a right inverse
and a left inverse must equal the named inverse before using uniqueness to
identify the inverse of the identity. The power chapter now separates definitions
from theorems: learners write and collect repeated products, motivate the zero and
negative exponent definitions, and only then earn exponent laws through worked
arguments that say plainly where a representative calculation is not a general
proof. Later practice reinforces mixed inverses and solving equations with factors
on both ends. Every challenge opens
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
