# Development plan

Last updated: 2026-08-27.

This document preserves the product discussion and six-phase roadmap. It is a
plan, not a claim that the planned features already exist. For the code's actual
state, verification evidence, and review instructions, read
[Audit handoff](audit-handoff.md).

## Product intent

Create a self-contained educational group-theory web app that works well on
desktop and mobile and typesets mathematics clearly. The primary audience is
students just introduced to groups in an undergraduate abstract algebra course.
Expert features are welcome only if they do not complicate that first experience.

The core activity is constructing a proof, not requesting an automatic answer:
choose a justified transformation, choose where to apply it, and append one new
line. The app should expose mathematical choices while handling mechanical
notation. It must preserve noncommutative product order.

Inspirations and nearby references:

- Euclidea: progressive challenges, earned tools, and shorter-proof goals.
- `../gaussian-elimination-trainer`: guidance levels, operation selection,
  exact mathematics, history, and mobile interaction.
- `../cayley-table-explorer`: warm paper palette, calm workbench layout, and
  focused explanations tied to concrete mathematical objects.
- `../graphical-limits-trainer`: device-local progress and browser regression
  tests. These references are context, not dependencies of this app.

## Intended mathematical model

### Terms

Eventually represent expressions as structured terms, independent of rendered
LaTeX or HTML:

- A generator/variable, such as `a`, `b`, `x`, `r`, or `s`.
- A distinguished identity term, displayed as `e`.
- A product containing an ordered list of factors.
- An inverse of a term.
- An integer power of a term, retained as notation rather than eagerly expanded.

Flatten nested products by associativity, but retain the structure underneath
inverses and powers. For example, `(ab)c` and `a(bc)` share a product
representation, while `((ab)^-1 c)^-1` retains its meaningful nested structure.
Associative rebracketing should not require a user action or consume a proof step.

Do not silently cancel inverses, remove identity factors, distribute inverses,
combine powers, or reorder factors as part of this structural normalization.
Those are the mathematical steps the learner is meant to choose.

This recursive term model is NOT implemented yet. The prototype uses `Factor[]`
with single-generator inverse flags and an identity flag.

### Three proof activities

1. **Expression chains:** every appended line is equal to the preceding term.
   Example: `a a^-1 b = e b = b`.
2. **Equation transformations:** each reversible step produces an equivalent
   equation. Example: `ax=b iff a^-1 ax=a^-1 b iff x=a^-1 b`.
3. **Challenges:** specify initial data, target, assumptions, and permitted
   rules. They can ask for an expression, identity, solved equation, or
   equivalence; conditional proofs come later.

Replacing an equal subterm preserves equality in a surrounding term and preserves
equivalence when done on either side of an equation, under the recorded assumptions.
Whole-equation operations need their own contracts. Left/right multiplication by
the same group term, inversion of both sides, and swapping sides are reversible.

`=`, `iff`, and `implies` must remain distinct. A genuine one-way inference must
not be labeled or executed as an equivalence. General implication handling is
deferred to Phase 6; many elementary group-equation operations need only `iff`.

### Rules, assumptions, and proof records

Rules should carry a stable identifier, pattern, substitution, direction,
preconditions, and explanation. Match terms, not their displayed strings.
Targets must support a term path and a contiguous span within a flat product.
This is necessary to recognize the `ab` in `(ab)^-1 a b` without manually
regrouping the outer product.

Every eventual proof step should record:

- Before and after statements.
- Rule identifier and direction.
- Exact target path/span and instantiated variables.
- Assumptions and lemma dependencies used.

An independent replay check should validate a stored proof using the same rule
contracts, rather than trusting displayed annotations or imported history.
The current history stores only result factors, a reason label, and a text detail.

Separate three things when designing the rule library: the trusted mathematical
kernel, the tools permitted in a challenge, and the step-counting convention.
For example, offering cancellation as a shortcut must not make a challenge
intended to establish cancellation circular. Freeze the permitted axioms/lemmas
for each challenge and record that ruleset with its score.

## Interaction design

Default workflow:

1. Select a law.
2. Highlight all valid locations in the current expression or equation.
3. Select one location.
4. If needed, choose a direction, substitution, or operation parameter.
5. Append exactly one justified transformation.

Also planned: select a subexpression first, then choose among applicable rules.
For nested terms, an outward selection control can reveal enclosing structure.
For products, allow contiguous range selection; do not require desktop drag
precision on touch devices. The exact touch gesture remains to be tested.

Keep unavailable rules explainable. A zero-match rule is not an incorrect
mathematical law. Reverse rules such as inserting `xx^-1` have infinitely many
possible instantiations: ask for the term and insertion location explicitly
rather than pretending all possibilities can be highlighted.

Use a central proof sheet and a rule library on desktop. On mobile, keep the
active expression and rule controls usable together without covering each other.
Reasons may collapse for space, but their details must remain accessible by
touch and keyboard, not just hover. Long terms should scroll locally rather
than shrinking into illegibility. Undo/redo must work across all proof actions.

### Input

Planned input has two complementary forms:

- Concise typed syntax with a live typeset preview, for example
  `a*b^-1*(c*d)^-1`.
- A mobile-friendly structured builder for generators, products, inverses,
  powers, parentheses, equality, and deletion.

The initial parser can be restricted, but its accepted grammar, identity
notation, generator naming, limits, and error messages must be explicit.
Never evaluate input as JavaScript or accept untrusted HTML/LaTeX commands.

## Challenges and progression

Start with identity/inverse manipulations, then equation-solving and basic lemmas.
Candidate later challenges and unlocks include:

- `(a^-1)^-1 = a` and `e^-1 = e`.
- `(ab)^-1 = b^-1 a^-1` (socks-and-shoes).
- Cancellation and uniqueness of identity/inverses.
- Elementary power definitions and laws.
- Conditional consequences of commuting elements or finite-order assumptions.

This is a candidate list, not a finalized dependency ordering. Author and check
an actual proof of each challenge using exactly its permitted tools before shipping it.
The theorem being proved must not be available directly or indirectly as a tool.
Dependencies must be acyclic.

Proposed teaching modes are Guided, Practice, and Free. The specific Practice
interaction is not settled; it need not copy matrix-entry exercises from the
Gaussian trainer. The student should still choose a meaningful mathematical step.

Record successful proof traces and personal-best lengths locally. Count committed
mathematical transformations, not taps, selections, or suppressed associativity.
Do not claim a globally shortest proof unless exhaustive verification supports it;
personal best and supplied benchmark are separate concepts. Keep proof/score
versions so a ruleset change does not silently change the meaning of old records.

## Relations and presentations

Later, allow the user to assume equations among specified generators. Provide
presets such as cyclic groups and the dihedral group of order `2n`:

```text
r^n = e
s^2 = e
srs = r^-1
```

State the order explicitly because dihedral notation varies. Other potential
presets include Klein four, quaternion, and commuting-generator examples.

Presentation relations constrain the named elements; they are not universal
schemas that can be applied to arbitrary substitutions. Their use must be
recorded in proofs. A result proved under extra relations must never unlock a
universal group theorem. Likewise, `a^n=e` alone means the order divides `n`,
not that the order is exactly `n`.

Allow both directions of an equality but do not promise a terminating complete
simplifier for arbitrary presentations. Recommendations and proof search must
be bounded, cancellable, and honest about an inconclusive result.

## Architecture and portability

The initial discussion proposed small vanilla JavaScript modules. Implementation
instead used the installed Sites scaffold: React/TypeScript, Vinext/Vite, KaTeX,
and Cloudflare/Sites integration. Preserve this distinction when reviewing the code.

Current responsibilities:

- `app/core.ts`: mathematical matching and transformation without DOM access.
- `app/page.tsx`: React interaction state, proof history, and typesetting.
- `app/globals.css`: responsive presentation.
- `tests/core.test.ts`: Node tests for the core.

As features grow, separate parser, recursive term model, rule catalog, proof
verifier, challenge data, presets, and persistence from the view. Exact filenames
can follow the existing TypeScript structure; the original `.mjs` filenames were
suggestions, not required interfaces.

The user's goal remains a self-contained browser app. Current mathematical
interaction is client-side, but the delivered scaffold requires a build and web
server; it is NOT an offline-tested, double-clickable HTML app or a verified
static GitHub Pages export. Decide the portable/offline distribution approach
before calling that requirement complete. No mathematical feature needs accounts,
a database, or a backend solver. Bundle math rendering assets locally.

## Roadmap and acceptance gates

### Phase 1 — Interaction prototype: implemented slice, acceptance incomplete

Implemented: a fixed `a a^-1 b c^-1 c` challenge, KaTeX rendering, inverse
cancellation with explicit `e`, identity removal, rule-first candidate highlighting,
annotated equality history, completion at `b`, undo/redo/restart, and responsive CSS.

Still needed to close the original phase rather than merely demo it:

- Restricted expression parsing/input and structural associative flattening.
  The current flat data structure alone is not a parser or nested term model.
- Usability decisions for clicking a whole highlighted range, overlapping
  targets, and accessible explanations.
- Reproducible desktop and actual 390px CSS-viewport tests, plus a real-phone
  trial. Earlier browser checks do not establish all of these.

Acceptance: the example completes in four explicit mathematical steps via either
inverse-pair order; every legal target is unambiguous; undo/redo and branching work;
the proof and controls remain usable on desktop and phone. Input tests cover the
documented subset and reject malformed input without losing the existing proof.

### Phase 2 — Core expression workbench: planned

Extend the term model and parser to nested products/inverses and integer powers.
Add identity/inverse-pair insertion, bidirectional rewrites, free expression
exploration, keyboard navigation, replay, and export (LaTeX plus structured proof;
URL sharing/import if practical). Do not auto-simplify away the steps being taught.

Acceptance: nested targets and product spans resolve correctly; each recorded
step replays; input/serialization round trips preserve structure modulo explicit
associative normalization; imports are validated and size-limited.

### Phase 3 — Equation workbench: planned

Add equations, local substitution on either side, left/right multiplication,
inversion of both sides, symmetry, and equation-solving challenges. Clearly
distinguish local rewrites from whole-equation operations.

Acceptance: each `iff` step has a reversible contract under the current assumptions;
side and multiplication order are explicit; expression-chain behavior still works.

### Phase 4 — Curriculum and progression: planned

Add the teaching modes, curated dependency-checked challenges, graduated hints,
unlocks, proof viewer, personal bests, and device-local persistence with export/reset.
Persisted data and imported proofs must be validated, not trusted as unlock evidence.

Acceptance: no circular proofs or assumption leakage; scores are comparable only
within their recorded ruleset; valid alternative proofs receive credit.

### Phase 5 — Presented groups: planned

Add custom relations and cyclic/dihedral presets first, assumption provenance,
scoped recommendations, and noncommutative examples. Treat more advanced presets
as optional until the beginner workflow is established.

Acceptance: relations apply only in their scope, proofs retain their hypotheses,
and presentation-specific results cannot become unrestricted universal rules.

### Phase 6 — Implications and expert tools: planned

Add conditional lemmas with matched/proved premises, explicit one-way inference,
bounded proof search for hints, benchmark comparisons, and shareable challenge
definitions. Introduce deeper tools through progressive disclosure.

Acceptance: inference direction and premise scope are checked; bounded searches
do not freeze the browser or mislabel failure to find a proof as disproof.

## Verification strategy

- Unit tests for parsing, structural equality, normalization, matching,
  substitution, invalid actions, and nonmutation.
- Proof replay tests and negative cases for tampering, locked rules, circular
  dependencies, incorrect arrow direction, and assumption leakage.
- Randomized term tests and evaluations in finite nonabelian examples as
  supplemental bug detection, not a proof that a universal rule is sound.
- Browser regression tests for complete proofs, both cancellation orders,
  undo/redo branching, target ambiguity, keyboard/touch behavior, scrolling,
  responsive geometry, and console errors.
- Explicit viewport measurements, enlarged text/zoom, reduced motion, screen
  reader checks, and real-device trials; screenshots alone are insufficient.

Immediate next work: audit this prototype, resolve Phase 1 gaps, and agree on the
recursive term/input design before expanding the rule library.
