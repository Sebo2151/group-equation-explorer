import { expect, test, type Page } from '@playwright/test';
import { beginProof, revealLaw } from './briefing.ts';

/**
 * Phase 4: the curriculum, and the things that make it a curriculum.
 *
 * Four behaviours are asserted here, and each one is a claim about what a
 * learner may and may not do rather than about how anything looks:
 *
 *   - a challenge opens only when the one before it is proved, except by link;
 *   - a law appears only after the challenge that proves it is finished;
 *   - hints escalate, act only at the last grade, and admit when the learner
 *     has gone somewhere the authored route does not go;
 *   - progress is stored as proofs, so a claim without one buys nothing.
 *
 * The last is the one worth being careful about: the test tampers with storage
 * the way a curious student with a console would, and asserts the app is not
 * fooled.
 */

const STORAGE_KEY = 'group-equation-explorer/progress/v1';

const heading = (page: Page, name: string) => page.getByRole('heading', { name });
const targets = (page: Page) => page.getByRole('button', { name: /\. Option \d+ of \d+\.$/ });
const laws = (page: Page) => page.locator('.rules-card .rule-card');

async function stepCount(page: Page) {
  const text = await page.locator('.status-pill').innerText();
  return Number(text.match(/\d+/)?.[0] ?? 0);
}

async function applyTarget(page: Page, index = 0) {
  const before = await stepCount(page);
  await expect(async () => {
    await targets(page).nth(index).click();
    expect(await stepCount(page)).toBe(before + 1);
  }).toPass({ timeout: 15_000 });
}

async function selectLaw(page: Page, name: string) {
  await beginProof(page);
  const button = page.locator(`.rules-card .rule-card[aria-label^="${name},"]`);
  await revealLaw(button);
  await expect(async () => {
    await button.click();
    await expect(page.locator('.selection-note strong')).toHaveText(name, { timeout: 1000 });
  }).toPass({ timeout: 15_000 });
}

/** Finish challenge 01 through the interface, the short way. */
async function proveFirstChallenge(page: Page) {
  await page.goto('/#challenge=cancel-pairs');
  await selectLaw(page, 'Cancel inverse pair');
  await applyTarget(page);
  await selectLaw(page, 'Remove identity');
  await applyTarget(page);
  await selectLaw(page, 'Cancel inverse pair');
  await applyTarget(page);
  await selectLaw(page, 'Remove identity');
  await applyTarget(page);
  await expect(page.locator('.status-pill')).toHaveClass(/is-complete/);
}

/**
 * Finish a challenge by taking the strongest hint over and over. Nothing here
 * knows anything about the mathematics, which is the point: if this cannot
 * finish a challenge, then neither can a learner who is stuck and asking.
 */
async function proveByHints(page: Page, id: string) {
  await page.goto(`/#challenge=${id}`);
  await beginProof(page);
  await expect(page.locator('.challenge-number')).not.toHaveText('··');

  for (let guard = 0; guard < 12; guard += 1) {
    if (await page.locator('.status-pill.is-complete').count()) return;

    await page.getByRole('button', { name: 'Hint', exact: true }).click();
    await expect(page.locator('.hint-card')).toBeVisible();
    await page.getByRole('button', { name: 'Tell me more' }).click();
    await page.getByRole('button', { name: 'Tell me more' }).click();
    await page.getByRole('button', { name: 'Take this step' }).click();
  }

  await expect(page.locator('.status-pill')).toHaveClass(/is-complete/);
}

test.beforeEach(async ({ page }) => {
  // Every test starts from a device that has proved nothing.
  await page.goto('/');
  await page.evaluate((key) => window.localStorage.removeItem(key), STORAGE_KEY);
  await page.reload();
});

/* Unlocking --------------------------------------------------------------- */

test('only the first challenge is open on a fresh device', async ({ page }) => {
  await expect(page.getByRole('button', { name: /^Challenge 01:.*Not yet proved/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Challenge 02:.*Locked until/ })).toBeVisible();
  await expect(page.locator('.challenge-entry.is-locked')).toHaveCount(25);
});

/**
 * A locked entry is a real button that explains itself and goes to what it is
 * waiting for, rather than a dead control. Pressing it must not open it.
 */
test('a locked entry sends the learner to the earliest unfinished prerequisite', async ({ page }) => {
  await page.locator('.chapter-card').last().locator('summary').click();
  // Retried, because this is the one assertion here whose first action is a
  // click on freshly reloaded markup: a click that lands before React attaches
  // hits the server render and does nothing.
  await expect(async () => {
    await page.getByRole('button', { name: /^Challenge 26:/ }).click();
    await expect(page.locator('.briefing-number')).toHaveText('Challenge 01', { timeout: 1000 });
  }).toPass({ timeout: 15_000 });
});

test('proving a challenge opens the next one and records the length', async ({ page }) => {
  await proveFirstChallenge(page);
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(heading(page, 'Choose something to prove')).toBeVisible();

  await expect(page.getByRole('button', { name: /^Challenge 01:.*Proved in 4 steps/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Challenge 02:.*Not yet proved/ })).toBeVisible();
  await expect(page.locator('.challenge-entry.is-locked')).toHaveCount(24);
});

test('a challenge briefing frames the work before revealing the workbench', async ({ page }) => {
  await page.goto('/#challenge=mixed-inverses');

  await expect(page.locator('.briefing-prompt')).toContainText('Think before you begin');
  await expect(page.locator('.briefing-prompt')).toContainText('Which outer operation should be resolved');
  await expect(page.locator('.proof-card')).toHaveCount(0);

  await beginProof(page);
  await expect(page.locator('#challenge-title')).toContainText('Reach');
  await expect(page.locator('.challenge-banner')).not.toContainText('Which outer operation');
});

test('the law palette groups available moves by what they accomplish', async ({ page }) => {
  await page.goto('/#challenge=solve-both-ends');
  await beginProof(page);

  const palette = page.getByRole('complementary');
  await expect(palette.getByText('Simplification', { exact: true })).toBeVisible();
  await expect(palette.getByText('Equation transformations', { exact: true })).toBeVisible();
  await expect(page.locator('.selection-note strong')).toHaveText('No law selected');
  await expect(page.locator('.rule-card[aria-pressed="true"]')).toHaveCount(0);
  await expect(targets(page)).toHaveCount(0);
  await expect(palette.locator('.purpose-group[open]')).toHaveCount(0);

  await selectLaw(page, 'Multiply on the left');
  await expect(palette.locator('.purpose-group[open]')).toHaveCount(1);
});

test('completion names the takeaway and offers the next challenge', async ({ page }) => {
  await proveFirstChallenge(page);

  await expect(page.locator('.success-takeaway')).toContainText('Takeaway');
  await expect(page.locator('.success-score')).toContainText('the expected proof takes');
  await expect(page.getByRole('button', { name: 'Try a different proof' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Course overview' })).toBeVisible();
  await page.getByRole('button', { name: 'Next challenge' }).click();
  await expect(page.locator('.briefing-number')).toHaveText('Challenge 02');
});

test('trying a different proof restarts without hiding the workbench', async ({ page }) => {
  await proveFirstChallenge(page);
  await page.getByRole('button', { name: 'Try a different proof' }).click();

  await expect(page.locator('.status-pill')).toContainText('0 steps');
  await expect(page.locator('.proof-lines .proof-line')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Begin proof' })).toHaveCount(0);
});

test('progress survives a reload, because it is stored on the device', async ({ page }) => {
  await proveFirstChallenge(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: /^Challenge 01:.*Proved in 4 steps/ })).toBeVisible();
});

/* Earned laws -------------------------------------------------------------- */

/**
 * The lemma arrangement, seen from the outside: the challenge that proves the
 * double-inverse law is not given it, and the challenge after it is.
 */
test('a lemma is not available in the challenge that proves it', async ({ page }) => {
  await page.goto('/#challenge=prove-double-inverse');
  await beginProof(page);
  const offered = await laws(page).evaluateAll((els) =>
    els.map((el) => el.getAttribute('aria-label') ?? ''),
  );
  expect(offered.join(' | ')).not.toMatch(/^Undo a double inverse|\| Undo a double inverse/);

  await page.goto('/#challenge=double-inverse');
  await beginProof(page);
  await expect(page.locator('.rule-card[aria-label^="Undo a double inverse,"]')).toHaveCount(1);
});

/**
 * Provenance is shown for a law the learner has *earned*, not for one that
 * merely happens to be in the ruleset — somebody who arrived by link has the
 * tool without having proved it, and should not be told they proved it. So this
 * walks the course to challenge 06 for real, taking the hints, which is also
 * the cheapest end-to-end check that the hints can finish an unfamiliar proof.
 */
test('a law earned by proving it says which challenge proved it', async ({ page }) => {
  for (const id of [
    'cancel-pairs',
    'insert-a-pair',
    'unique-right-inverse',
    'unique-left-inverse',
    'prove-identity-inverse',
    'prove-double-inverse',
  ]) {
    await proveByHints(page, id);
  }

  await page.goto('/#challenge=double-inverse');
  await beginProof(page);
  await expect(page.locator('.rule-card[aria-label^="Undo a double inverse,"]')).toHaveAttribute(
    'aria-label',
    /proved in challenge 06/,
  );

  // And it is named where it was earned, too.
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.locator('.earned-law')).toContainText(['Invert the identity']);
});

test('the power lesson records definitions without calling them theorems', async ({ page }) => {
  await proveByHints(page, 'powers');

  await expect(page.locator('.success-defined')).toContainText(
    'Definition introduced: Write a power out and Combine into a power',
  );
  await expect(page.locator('.success-earned')).toHaveCount(0);

  await page.getByRole('button', { name: 'Course overview' }).click();
  await expect(page.getByRole('heading', { name: 'Definitions introduced' })).toBeVisible();
  await expect(page.locator('.earned-law.is-definition').first()).toContainText(
    'defined in challenge 11',
  );
});

/* Hints -------------------------------------------------------------------- */

test('hints escalate, and only the last grade offers the move', async ({ page }) => {
  await page.goto('/#challenge=cancel-pairs');
  await beginProof(page);
  await page.getByRole('button', { name: 'Hint', exact: true }).click();

  const card = page.locator('.hint-card');
  await expect(card).toContainText('Hint 1 of 3');
  await expect(page.getByRole('button', { name: 'Take this step' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Tell me more' }).click();
  await expect(card).toContainText('Hint 2 of 3');
  await expect(page.getByRole('button', { name: 'Take this step' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Tell me more' }).click();
  await expect(card).toContainText('Hint 3 of 3');
  await expect(page.getByRole('button', { name: 'Take this step' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tell me more' })).toHaveCount(0);
});

test('the step a hint offers is an ordinary step that can be undone', async ({ page }) => {
  await page.goto('/#challenge=cancel-pairs');
  await beginProof(page);
  await page.getByRole('button', { name: 'Hint', exact: true }).click();
  await page.getByRole('button', { name: 'Tell me more' }).click();
  await page.getByRole('button', { name: 'Tell me more' }).click();
  await page.getByRole('button', { name: 'Take this step' }).click();

  expect(await stepCount(page)).toBe(1);
  await page.getByRole('button', { name: 'Undo' }).click();
  expect(await stepCount(page)).toBe(0);
});

/**
 * The case the hint design turns on. Cancelling the second pair first is
 * perfectly correct and is not the authored route; the app must say so rather
 * than pointing somewhere misleading or implying a mistake.
 */
test('a correct line off the authored route is named as different, not wrong', async ({ page }) => {
  await page.goto('/#challenge=cancel-pairs');
  await selectLaw(page, 'Cancel inverse pair');
  await applyTarget(page, 1);

  await page.getByRole('button', { name: 'Hint', exact: true }).click();
  const card = page.locator('.hint-card');
  await expect(card).toContainText('different way');
  await expect(card).toContainText('Nothing is wrong with your line');

  await page.getByRole('button', { name: 'Show the route I know' }).click();
  await expect(page.locator('.hint-route .proof-line')).toHaveCount(5);

  await page.getByRole('button', { name: 'Step back onto it' }).click();
  expect(await stepCount(page)).toBe(0);
});

test('free exploration has no route, and the hint control is not offered', async ({ page }) => {
  await page.goto('/#free');
  await expect(page.getByRole('button', { name: 'Hint', exact: true })).toHaveCount(0);
});

/* Reading a proof back ----------------------------------------------------- */

test('a proved challenge can be read back, and reading is not working', async ({ page }) => {
  await proveFirstChallenge(page);
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: /^Read your proof/ }).click();

  await expect(heading(page, 'Cancel what undoes itself')).toBeVisible();
  await expect(page.locator('.recorded-proof .proof-line')).toHaveCount(5);
  // Nothing on this screen acts on the proof.
  await expect(targets(page)).toHaveCount(0);
  await expect(page.getByRole('complementary')).toHaveCount(0);
});

test('arriving at a recorded proof moves focus to it', async ({ page }) => {
  await proveFirstChallenge(page);
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: /^Read your proof/ }).click();

  await expect(heading(page, 'Cancel what undoes itself')).toBeFocused();
});

/* Progress is proofs, not claims ------------------------------------------- */

/**
 * The acceptance criterion: persisted data is validated, not trusted as unlock
 * evidence. Both forgeries a person would actually try are checked — a
 * completion with no proof behind it, and a real proof relabelled as a shorter
 * one to take a personal best it did not earn.
 */
test('a completion claimed in storage without a proof buys nothing', async ({ page }) => {
  await page.evaluate(
    ([key, body]) => window.localStorage.setItem(key, body),
    [
      STORAGE_KEY,
      JSON.stringify({
        format: 'group-equation-explorer/progress',
        version: 1,
        best: {
          cancellation: { steps: 1, ruleset: ['left-multiply'], record: null },
          'cancel-pairs': { steps: 1, ruleset: ['cancel-inverse'], record: null },
        },
      }),
    ] as const,
  );
  await page.reload();

  await expect(page.locator('.notice')).toContainText('no longer check out');
  await expect(page.locator('.course-progress')).toContainText(/0\s*of 26/);
  await expect(page.getByRole('button', { name: /^Challenge 02:.*Locked until/ })).toBeVisible();
});

test('a real proof relabelled as shorter is refused rather than believed', async ({ page }) => {
  await proveFirstChallenge(page);
  await page.goto('/');
  await page.evaluate((key) => {
    const stored = JSON.parse(window.localStorage.getItem(key)!);
    stored.best['cancel-pairs'].steps = 1;
    window.localStorage.setItem(key, JSON.stringify(stored));
  }, STORAGE_KEY);
  await page.reload();

  await expect(page.locator('.course-progress')).toContainText(/0\s*of 26/);
});

test('progress can be cleared, and clearing relocks the course', async ({ page }) => {
  await proveFirstChallenge(page);
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: 'Clear progress' }).click();

  await expect(page.locator('.course-progress')).toContainText(/0\s*of 26/);
  await expect(page.getByRole('button', { name: /^Challenge 02:.*Locked until/ })).toBeVisible();

  // And it is gone from the device, not merely from the screen.
  await page.reload();
  await expect(page.locator('.course-progress')).toContainText(/0\s*of 26/);
});

/* Goal shapes -------------------------------------------------------------- */

/**
 * Solving for x is a shape, not one particular line, so a learner who clears
 * the a by another route still finishes. Here the goal is met by a line that is
 * not the one the authored proof reaches.
 */
test('solving for x accepts any route that leaves x by itself', async ({ page }) => {
  await page.goto('/#challenge=solve-left');
  await selectLaw(page, 'Multiply on the left');
  await expect(page.locator('#challenge-title')).toContainText('x by itself on the left');
  await page.getByLabel('Multiply by this term').fill('a^-1');
  await expect(async () => {
    await page.getByRole('button', { name: /^Multiply on the left\./ }).click();
    expect(await stepCount(page)).toBe(1);
  }).toPass({ timeout: 15_000 });

  await selectLaw(page, 'Cancel inverse pair');
  await applyTarget(page);
  await selectLaw(page, 'Remove identity');
  await applyTarget(page);

  await expect(page.locator('.status-pill')).toHaveClass(/is-complete/);
});
