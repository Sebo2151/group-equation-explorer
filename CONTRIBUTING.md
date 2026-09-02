# Contributing

Bug reports, accessibility observations, pedagogical suggestions, and code
contributions are welcome.

## If you are a student or an instructor using this

The most useful thing you can send is a place where the app got in the way of
the mathematics. Some examples of what is worth reporting:

- a challenge whose wording made you unsure what was being asked;
- a step you believed was legal that the app would not let you take;
- a law whose stated reason did not match what you thought had happened;
- a hint that pointed somewhere unhelpful;
- anything that was hard to read, hard to tap, or hard to reach by keyboard.

A proof you could not finish is a report, not a failure. Use **Share** on the
proof screen to get a link that replays exactly where you were, and include it.

## Reporting an interface bug

Please include:

- browser and operating system;
- approximate screen size or device model;
- the challenge, or the starting expression in free exploration;
- the sequence of clicks that produced the issue, or a share link;
- a screenshot when possible.

## Before submitting a change

Run the full set:

```bash
npm test
npm run lint
npm run build
npm run test:browser
```

The browser suite needs `npx playwright install chromium` on its first run, and
it exercises both a desktop viewport and a genuine 390px phone profile. All of
these also run in CI before the site is deployed.

Two constraints are worth stating in advance, because they are easy to break by
accident:

- **No rule may assume commutativity.** The soundness tests evaluate every law
  over every assignment of generators in S3 and D4, both non-abelian. A new law
  needs to be added there too.
- **A challenge may not be granted the law it exists to prove.** The curriculum
  test walks the whole course and fails if a derived law is offered before the
  challenge that establishes it. If you add a challenge, that test is what tells
  you where in the order it belongs.

Design background, and the reasoning behind the parts that look unusual, is in
[docs/design-notes.md](docs/design-notes.md).
