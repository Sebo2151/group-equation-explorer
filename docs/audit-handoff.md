# Audit handoff for a fresh reviewer

Snapshot date: 2026-08-27. Implementation baseline:
`114ca4cf12f0e27f8df7f07a0fe89a370728af7c` (`Build Phase 1 proof workbench`).
This handoff and the development plan were added afterward. Always check the
current working tree before assuming that this snapshot is still current.

> **Largely superseded.** An audit pass against this document was completed on
> 2026-08-27 and its confirmed defects were fixed; see
> [audit-2026-08-27.md](audit-2026-08-27.md). Phase 2 was then implemented, which
> replaced the flat `Factor[]` model this document describes with a recursive
> term model, added a parser, powers, insertion and reverse rules, challenges
> with per-challenge rulesets, free exploration, and export/import; see
> [phase-2-2026-08-27.md](phase-2-2026-08-27.md).
>
> Everything in "What exists" below is now historical: `app/core.ts` no longer
> exists. The "Concrete review priorities" section is still useful as a list of
> *questions worth asking*, but several of its specific items are resolved and
> its file references are stale. Read the two later records first, and treat
> this file as the origin of the review's standing concerns rather than as a
> description of the code.

## Read first

1. [Development plan](development-plan.md): product intent, mathematics, six
   phases, unresolved choices, and acceptance gates.
2. [README](../README.md): commands and entry points.
3. [Audit record](audit-2026-08-27.md): what the first audit reproduced, fixed,
   and left open.
4. [Phase 2 record](phase-2-2026-08-27.md): the current implementation, the
   decisions taken where the plan left a choice, and what remains unverified.
5. `app/term.ts`, `app/parse.ts`, `app/rules.ts`, `app/challenges.ts`,
   `app/proof.ts`, `app/serialize.ts`, `app/render.ts`, `app/page.tsx`,
   `app/globals.css`, and the suites in `tests/`.
6. `package.json`, `tsconfig.json`, `vite.config.ts`, and `app/layout.tsx` when
   reviewing tooling, portability, rendering, or hosting.

The task is an audit of an early prototype, not a request to implement the whole
roadmap. Distinguish current defects from missing planned features and from
architecture recommendations. A review request alone does not authorize source
changes, dependency upgrades, server termination, commits, or publication.

## What existed at Phase 1 (historical)

This section describes the code as it was before the Phase 2 work. It is kept
for the reasoning it records, not as a current description.

- One hardcoded expression: `a a^-1 b c^-1 c`, with the target `b`.
- An ordered `Factor[]` representation; each factor has a string base and
  optional inverse/identity flags. No parser or recursive expression tree.
- Two rules: cancel adjacent inverse factors to an explicit identity, and
  remove an identity factor. The engine rejects a target not in its candidate list
  and copies input factors before rewriting.
- React history containing result factors plus reason/detail text, with a cursor
  for undo/redo. A new transformation after undo discards the redo branch.
- Rule-first highlighting. Only the starting factor of each target is clickable;
  the other factor in a highlighted inverse pair is disabled.
- KaTeX rendering, a hide/show reasons toggle, and responsive CSS. Detailed
  reasons currently use the HTML `title` attribute, not a touch-friendly inspector.
- A generated social image in `public/og.png`. It is branding, not mathematical
  evidence; canonical formulas must come from the symbolic renderer.

No custom input, powers, nested inverses, equation mode, implication mode,
custom relations, user progress storage, unlock system, proof replay, or proof
import/export is implemented. Completion is currently detected by comparing the
rendered TeX string to `'b'`; this should not become the general proof checker.

## Concrete review priorities

### Mathematical representation and validation

- Are the rule matcher and transformer correct for the present restricted domain?
  Confirm they cannot commute factors or cancel unequal bases.
- What invariants are needed before accepting external terms? Consider a base
  named `e` versus the identity flag, conflicting flags, invalid runtime rule IDs,
  arbitrary base strings, and imported malformed data. TypeScript types alone
  will not validate future JSON or user input.
- The empty factor list displays as `e`. Removing a sole explicit `e` therefore
  produces the same displayed expression. Decide how to handle such no-op steps
  before general challenges and scoring.
- Keep associative flattening separate from mathematical simplification. Do not
  erase identity/cancellation steps while introducing the recursive model.

### Target selection and pedagogy

- Check both halves of highlighted inverse pairs: does the clickable area match
  what a student expects? Verify overlapping pairs such as `a a^-1 a`; the core
  test reports both, but this is not an exposed UI challenge.
- Inspect identity-only highlighting, where the CSS target-start treatment is
  also used without a target-end factor.
- Does the mobile dock cover the active line at any proof length, scroll
  position, font size, or orientation? Are the latest expression and success
  feedback discoverable after each action?
- On small screens, rule formulas/descriptions and the selection note are hidden.
  Is there still enough information to learn the rule and understand zero matches?
- Inspect keyboard focus after a transformed target is removed, accessible math
  labels, live-region verbosity, contrast, touch target sizes, and reason details.

### Proof history and future soundness

- Test both cancellation orders, undo/redo across completion, restart, and making
  a different move after undo. Verify the discarded future cannot reappear.
- Stored labels are not proof certificates. Recommend an explicit rule/target/
  substitution record and verifier before importing proofs or unlocking lemmas.
- Keep hypothetical custom relations separate from universally quantified rule
  schemas. Future unlocks must carry assumption/dependency provenance.

### Tooling, security, and distribution

- The math UI is client-side, but the scaffold includes a server/build and Sites
  integration. Do not call it an offline-tested standalone static app.
- A successful Vinext build or lint run is not evidence of a full TypeScript
  check. Review typings and configuration separately if relevant.
- User input is not currently accepted. Before adding it, review generator
  escaping, KaTeX options, parser limits, and all `dangerouslySetInnerHTML` paths.
- The initial dependency installation reported audit advisories. They have not
  been triaged. Inspect current evidence before recommending a targeted update;
  do not run `npm audit fix --force` as part of a read-only review.
- Social metadata uses relative `/og.png` URLs and has no established production
  `metadataBase`. Verify the resolved metadata if hosting work is later requested.

These are audit targets, not assertions that every item is a reproduced defect.
Record exact locations, reproduction steps, impact, and confidence for findings.

## Validation evidence and limits

Superseded. For the current evidence — 126 Node tests, a clean typecheck and
lint, and two browser suites across a desktop viewport and a genuine 390px phone
profile — and for the two things that could **not** be verified on this machine
(the production build, blocked by a Dropbox file lock on `dist/`, and any git
operation, blocked by a `.git` ownership mismatch), see the
[Phase 2 record](phase-2-2026-08-27.md).

The original Phase 1 evidence and its measurement caveat are preserved in the
[audit record](audit-2026-08-27.md).

Useful commands (Node requirement is in `package.json`):

```bash
npm test
npm run lint
npx tsc --noEmit --incremental false
npm run build
npm run test:browser
```

Coordinate a build if the development server is in use: Windows file locks and
build/dev cache interference were encountered previously.

## Local preview and operational context

The user most recently asked to keep the server available for PC/phone trials.
Do not stop or rebuild it merely to inspect documentation. Process IDs, port
ownership, and IP addresses are transient; inspect them before changing anything.

For a network-accessible preview, the verified command is:

```bash
npm run dev -- --hostname 0.0.0.0
```

Vinext uses `--hostname`, not `--host`. On 2026-08-26, both localhost and
`192.168.0.210:3000` returned HTTP 200. The phone needs the same LAN and suitable
firewall access. That IP and server uptime have not been revalidated for this
documentation update.

Development troubleshooting history:

- Interrupting the terminal did not always stop its child server. Verify the
  exact process and listener; do not kill unrelated Node processes.
- Switching between build/dev produced stale React JSX-runtime errors. The
  generated `node_modules/.vite` and `.vinext` caches were cleared and recreated.
  Cache deletion is not a routine audit step, and source must not be removed.
- Git inside the sandbox may report ownership or `.git` write restrictions.
  Do not change global safety settings or bypass permissions to perform an audit.

## Hosting history: not an action item for this audit

A Sites project was created and source pushed during the first implementation.
`.openai/hosting.json` contains its existing project ID; do not create a
second project. The first saved deployment remained `publishing` without a URL
in the last check on 2026-08-26. The user interrupted repeated polling and asked
for a local preview instead. Its status has not been rechecked for this handoff.

No hosting, publishing, access changes, or repeated deployment polling are
needed to audit the code or update these documents. No credentials belong in
the handoff, repository, or audit report.

## Suggested prompt for the next reviewer

> Read README.md, docs/development-plan.md, docs/audit-handoff.md,
> docs/audit-2026-08-27.md, and docs/phase-2-2026-08-27.md, then audit the
> current implementation. Focus on the soundness of the term model and the rule
> catalogue, target and gap resolution in nested terms, parser and import
> validation, proof-record integrity and the replay verifier, per-challenge rule
> gating against circular proofs, and mobile/accessibility behaviour. Separate
> reproducible defects from Phase 3-6 features and from optional
> recommendations. Cite files/lines and give concrete reproduction steps or
> tests. Do not implement changes, publish, alter dependencies, or stop the
> running server. Report what you verified and what remains untested.
