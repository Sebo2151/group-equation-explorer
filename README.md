# Group Equation Explorer

An interactive proof workbench for learning how group axioms transform expressions, one justified step at a time.

## Phase 1

The opening challenge asks the learner to simplify

```text
a a^-1 b c^-1 c
```

to `b`. Selecting a group law highlights every legal target in the expression. Applying a law appends the resulting expression and its reason to an equality chain. The current vertical slice includes:

- rule-first target highlighting;
- inverse cancellation and identity removal;
- explicit equality history and optional reason labels;
- undo, redo, and restart;
- KaTeX mathematical typesetting;
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

## Validate

```bash
npm test
npm run lint
npm run build
```

## Project shape

- `app/core.ts` — factor representation, rule matching, and verified transformations
- `app/page.tsx` — proof state and interaction
- `app/globals.css` — visual system and responsive layout
- `tests/core.test.ts` — algebra engine tests

The application is browser-only: it has no accounts, database, tracking, or external data service.
