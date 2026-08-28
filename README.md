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

## Phase 1

This is a fixed-example interaction prototype, not the full expression engine.
The original Phase 1 acceptance is incomplete: expression parsing/input and
reproducible target-selection and viewport tests remain. There is no recursive
term model, equation mode, custom relations, or unlock system yet.

The opening challenge asks the learner to simplify

```text
a a^-1 b c^-1 c
```

to `b`. Selecting a group law marks every legal target with its own bracket beneath the
expression; overlapping targets get separate brackets, so no two candidates ever
share a control. Applying a law appends the resulting expression and its reason
to an equality chain. The current vertical slice includes:

- rule-first target marking, one control per candidate span;
- inverse cancellation and identity removal;
- explicit equality history and optional reason labels;
- undo, redo, and restart over a pure proof-history reducer;
- KaTeX typesetting, with all accessible text supplied as spoken forms rather
  than TeX source;
- responsive desktop and mobile layouts; and
- a DOM-free, tested transformation engine.

Associativity is intentionally suppressed in the interface: products are represented as flat factor lists, so students do not spend their time rearranging parentheses.

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
```

There is no committed browser regression suite yet, and no real-device trial has
been run; both remain open. See the audit record for the current gaps.

## Project shape

- `app/core.ts` — factor representation, the rule table, target spans, validation,
  and verified transformations
- `app/proof.ts` — proof history as a DOM-free reducer (apply, undo, redo, restart)
- `app/page.tsx` — React interaction and typesetting
- `app/globals.css` — visual system and responsive layout
- `tests/core.test.ts`, `tests/proof.test.ts` — engine and proof-history tests

The mathematical interaction runs in the browser and uses no database or backend
solver. The current React/Vinext/Sites scaffold still requires a build and web
server; offline standalone operation and static GitHub Pages export are not yet
implemented or verified.
