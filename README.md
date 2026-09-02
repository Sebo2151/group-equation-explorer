# Group Equation Explorer

A proof workbench for a first course in abstract algebra. You are given an
expression or an equation and a target, and you get there the way a
mathematician does: by choosing a group law, choosing where to apply it, and
adding one justified line. The app handles the notation. It never does the
mathematics for you.

There is no automatic *simplify* button, because deciding what to simplify is
the thing being learned.

## Try it

<https://sebo2151.github.io/group-equation-explorer/>

It runs entirely in your browser. There is no account, no sign-in, and nothing
to install.

## What a proof looks like

Pick a law from the palette, and every place it may legally be used is marked
with a bracket under the current line. Click one, and the result is appended
with its reason recorded beside it. The chain of lines *is* the proof.

Products are written without parentheses — `abc`, not `(ab)c` — because
associativity is free here and rearranging brackets is not a mathematical step.
Order is never changed for you: the group is not assumed to be abelian, and
`ab` and `ba` stay distinct throughout.

A line may be an equation as well as an expression. Expressions are joined by
`=` and equations by `⟺`, since each equation is a statement rather than a
quantity. On an equation you may either rewrite inside one side, or apply a law
to the statement as a whole: multiply both sides on the left, multiply both
sides on the right, invert both sides, or swap them.

## The course

Twenty-six challenges in five chapters, unlocking in order:

1. **Identity and inverse moves** — recognize inverse pairs and deliberately
   create useful ones.
2. **Earn the inverse laws** — prove inverse uniqueness, then apply it to the
   identity, double-inverse, and socks-and-shoes laws.
3. **Build the power laws** — explain zero and negative exponents and justify
   the rules for inversion and exponent addition.
4. **Solve without commuting** — solve group equations and derive left and
   right cancellation.
5. **Mixed proof fluency** — combine inverse laws and solve equations with
   factors on both ends.

What you earn as you go is *laws*. `(a^-1)^-1 = a`, socks-and-shoes, `e^-1 = e`
and cancellation are each proved in a challenge of their own before any later
challenge may use them in a single step. Nothing is available to you before you
have derived it, and a test walks the whole course and fails if it ever is.

Hints come in three grades: which part of the palette to look in, then the law
and where it applies, then the move itself offered as a control. They follow a
reference proof shipped with each challenge. There is no proof search, so if
you have gone a different way the app says exactly that — your line is not
wrong, it is simply not on the route the app knows — and offers you the route,
or a step back onto it.

## Typing an expression

In free exploration you can start from anything you like. Products are written
by juxtaposition, with `*` and `·` accepted as optional separators:

```text
ab          a b          a*b
(ab)^-1 c   a^3          a^-2        (a^2)^3
r2 s        e
a x = b     (a b)^-1 = b^-1 a^-1
```

A single `=` makes the line an equation. The relation is recognised outside the
term grammar, so it cannot appear inside parentheses, under an inverse, or in
an exponent; a line with two of them is refused. The start and the goal must
agree about being an equation — an equation is not provably equal to an
expression.

A generator is one letter followed by any digits, so `r2` is a generator and
`a^2` is a power; juxtaposition is never ambiguous. `e` is the identity and may
not name a generator. `a^1` and `a^-1` are notation for the term and its
inverse, not extra structure. Repeated powers need parentheses. Input is
length, depth, exponent, and node limited, and is never evaluated.

While typing in a field, Ctrl/Cmd+Z and redo edit the text; outside fields,
they navigate proof history. Candidates can also be reached by arrow keys and
digits.

## Your work stays on your device

Progress is stored in your browser's local storage and goes nowhere else. There
is no server to send it to: the site is static files, and the mathematics all
runs locally. Nothing is collected, and no one — including the author — can see
what you have proved.

Two consequences worth knowing. Progress is per-browser and per-device, so
working on a laptop and a phone gives you two separate records; and clearing
site data clears your progress. You can export your work, and re-import it,
from the menu.

What is stored is the proofs themselves rather than a list of completion flags.
That is what makes it evidence: reading it back replays every record against
the same rule contracts the interface uses, and drops anything that does not
check out — including a real proof relabelled with a shorter step count. A
completion can be claimed in storage, but it cannot be bought there.

## Sharing a proof

Every proof can be exported as a structured record or as LaTeX, and shared as a
link that replays it. An imported proof is verified step by step against the
same rule contracts before anything is displayed, and a proof claiming a
challenge is rejected if it used tools that challenge forbids.

## What is not built yet

- **Presented groups.** No custom relations, no cyclic or dihedral presets.
  Every rule in the catalogue is a theorem of *any* group.
- **One-way inference.** A proof chain is a chain of equivalences throughout.
  Establishing that one statement *follows from* another without the converse
  is not expressible by any law in the catalogue.
- **Accessibility verification.** No real-device trial has been run, and screen
  reader, zoom, and enlarged-text passes remain open. The browser suite asserts
  that accessible names never contain TeX, which is not the same as having been
  tested with a screen reader.

Those first two are Phases 5 and 6 of the
[development plan](docs/development-plan.md).

## Run locally

```bash
npm install
npm run dev
```

Then open the address the server prints. For a phone on the same network:

```bash
npm run dev -- --hostname 0.0.0.0
```

Use the LAN address printed by the server; do not assume an old one is still
current. Firewall access may need to be allowed for the private network.

## Validate

```bash
npm test
npm run lint
npm run build
npm run test:browser
npm run test:pages
```

Soundness of the rules is checked by evaluation as well as by structure. Every
law is applied to sample terms and the result compared, over every assignment
of generators to elements, in S3 and D4 — both non-abelian, which is the point.
A rule that quietly assumed commutativity would be structurally impeccable and
would fail there immediately. Note what this cannot see: left and right
multiplication are *both* sound, so only the shape of the result distinguishes
them, and that is asserted separately.

`npm run test:browser` runs the Playwright suites in `tests/browser` against the
completed static export, at a desktop viewport and a genuine 390px phone
profile. It asserts behavioural
invariants — focus destinations, dock-versus-active-line geometry, one control
per candidate, no TeX in accessible names — rather than appearance, so it
should survive a redesign. First run needs `npx playwright install chromium`.

`npm run test:pages` serves the completed export at the real GitHub Pages
project path and checks that it hydrates without missing assets or browser
errors. Run it after `npm run build`.

`npm run build` typechecks as part of building, which is why no separate `tsc`
step is listed.

## Deploy

The site is a static export. `npm run build` writes `out/`, and
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) runs the checks
above and publishes it to GitHub Pages on every push to `main`.

Two things to know if you are changing this:

- `basePath` in [`next.config.ts`](next.config.ts) must match the repository
  name, because Pages serves a project repository from a subdirectory. It is
  applied to production builds only, so that the dev server and the Playwright
  suite can keep addressing the app at the origin root.
- If you are working inside a synced folder (Dropbox, OneDrive), the sync
  client will intermittently hold a lock on files the export step is renaming
  and fail the build with `EBUSY`. Delete `.next` and run it again. CI does not
  have this problem.

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

## Development and audit context

- [Design notes](docs/design-notes.md) — how the workbench, the equation model,
  the shell, and the curriculum came to work the way they do.
- [Development plan](docs/development-plan.md) — product intent, mathematical
  model, interaction design, six-phase roadmap, and acceptance criteria.
- [Audit handoff](docs/audit-handoff.md) — implementation status, test
  evidence, known limitations, review priorities, and a suggested audit prompt.
- [Audit record, 2026-08-27](docs/audit-2026-08-27.md) — the first audit pass:
  defects reproduced and fixed, security posture, and what remains untested.
- [Phase 4 record](docs/phase-4-2026-08-28.md) — the curriculum, the unlock and
  hint designs, why one rule had to widen, and what was left undone.

Feedback is welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE).
