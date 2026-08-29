import { expect, test, type Page } from '@playwright/test';
import { beginProof, revealLaw } from './briefing.ts';

/**
 * Invariants, not appearance. Every assertion here should still make sense if
 * the bracket treatment is redesigned or the term model becomes recursive:
 * these are properties of the interaction, not of the current markup.
 */

const laws = { inverse: 'Cancel inverse pair', identity: 'Remove identity' } as const;

/** Controls are found by their accessible name, so markup can change freely. */
const targets = (page: Page) => page.getByRole('button', { name: /at .*\. Option \d+ of \d+\./ });

/**
 * The law picker lives in the page's complementary region. Scoping there keeps
 * it distinct from the candidate controls, whose names also begin with the law.
 */
const lawButton = (page: Page, law: string) =>
  page.locator(`.rules-card .rule-card[aria-label^="${law},"]`);

/**
 * The markup is server-rendered, so a click can land before React has attached
 * and be silently lost. Rather than guessing at a hydration gate, each
 * interaction retries until its own effect is observable.
 */
async function selectLaw(page: Page, law: string) {
  const button = lawButton(page, law);
  await revealLaw(button);
  await expect(async () => {
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true', { timeout: 1000 });
  }).toPass({ timeout: 15_000 });
}

async function stepCount(page: Page) {
  const text = await page.locator('.status-pill').innerText();
  return Number(text.match(/\d+/)?.[0] ?? 0);
}

/** Apply one candidate, waiting until the proof actually grows by a step. */
async function applyTarget(page: Page, index = 0) {
  const before = await stepCount(page);
  await expect(async () => {
    await targets(page).nth(index).click();
    expect(await stepCount(page)).toBe(before + 1);
  }).toPass({ timeout: 15_000 });
}

/**
 * Scrolling is smooth and starts asynchronously, so sampling a couple of frames
 * after the click can catch the page before it has begun to move. Require the
 * position to hold still across several samples spanning a real interval.
 */
async function scrollSettled(page: Page) {
  await page.waitForFunction(
    () =>
      new Promise<boolean>((resolve) => {
        let last = window.scrollY;
        let stable = 0;
        const id = setInterval(() => {
          if (window.scrollY === last) stable += 1;
          else stable = 0;
          last = window.scrollY;
          if (stable >= 4) {
            clearInterval(id);
            resolve(true);
          }
        }, 50);
      }),
    null,
    { timeout: 5000 },
  );
}

/** The candidate count a law advertises, read from its accessible name. */
async function advertisedCount(page: Page, law: string) {
  const name = await lawButton(page, law).getAttribute('aria-label');
  return Number(name!.match(/(\d+) place/)![1]);
}

/** The canonical four-step solution, cancelling the left pair first. */
async function solve(page: Page) {
  for (const law of [laws.inverse, laws.identity, laws.inverse, laws.identity]) {
    await selectLaw(page, law);
    await applyTarget(page);
  }
  await expect(page.getByText('Expression simplified')).toBeVisible();
}

// The app opens on the menu now, so these start at the opening challenge
// directly rather than relying on what the app happens to load first.
test.beforeEach(async ({ page }) => {
  await page.goto('/#challenge=cancel-pairs');
  await beginProof(page);
  await expect(page.getByRole('heading', { name: 'Build an equality chain' })).toBeVisible();
});

test('every candidate gets exactly one control, and they are distinct', async ({ page }) => {
  // The count advertised on the law must equal the number of controls offered.
  // This is what makes an overlapping pair unambiguous: no two candidates can
  // share a control, whatever the control looks like.
  for (const law of [laws.inverse, laws.identity]) {
    const count = await advertisedCount(page, law);
    await selectLaw(page, law);

    await expect(targets(page)).toHaveCount(count);

    const names = await targets(page).evaluateAll((els) =>
      els.map((el) => el.getAttribute('aria-label')),
    );
    expect(new Set(names).size, 'candidate controls must be distinguishable').toBe(count);
  }
});

test('each control announces its own span and its position among the options', async ({ page }) => {
  await selectLaw(page, laws.inverse);
  await expect(targets(page).nth(0)).toHaveAccessibleName(
    'Cancel inverse pair at a times a inverse. Option 1 of 2.',
  );
  await expect(targets(page).nth(1)).toHaveAccessibleName(
    'Cancel inverse pair at c inverse times c. Option 2 of 2.',
  );
});

test('no accessible name anywhere contains TeX source', async ({ page }) => {
  // `a^{-1}` in an accessible name is announced as "a caret left brace minus
  // one right brace". Checked before and after a move, since step reasons and
  // details are generated at rewrite time.
  const scan = async () => {
    const names = await page.locator('[aria-label], [role=math]').evaluateAll((els) =>
      els.map((el) => el.getAttribute('aria-label') ?? ''),
    );
    const text = await page.locator('.reason, .reason-detail, .selection-note').allInnerTexts();
    return [...names, ...text];
  };

  await selectLaw(page, laws.inverse);
  await applyTarget(page);
  await page.locator('.reason').first().click();

  for (const value of await scan()) {
    expect(value, `TeX leaked into "${value}"`).not.toMatch(/[\\^{}]|\$/);
  }
});

test('focus never falls to the document body after a committed move', async ({ page }) => {
  // The clicked control unmounts on every move. If focus is not re-homed, a
  // keyboard user re-tabs from the top of the document for each step.
  await selectLaw(page, laws.inverse);

  for (let step = 0; step < 4; step += 1) {
    await selectLaw(page, step % 2 === 0 ? laws.inverse : laws.identity);
    await applyTarget(page);

    const focused = await page.evaluate(() => document.activeElement?.tagName ?? 'NONE');
    expect(focused, `focus lost after step ${step + 1}`).not.toBe('BODY');
  }
});

test('focus is re-homed even when the selected law no longer applies', async ({ page }) => {
  // Regression: the first fix only handled "a target remains" and "complete",
  // and still dropped to <body> when neither held.
  await selectLaw(page, laws.inverse);
  await applyTarget(page);

  // Removing the identity from `e b c^-1 c` yields `b c^-1 c`, which offers no
  // identity target. Focus must be checked with no intervening click, or
  // selecting a law would itself put focus somewhere and mask the failure.
  await selectLaw(page, laws.identity);
  await applyTarget(page);

  await expect(targets(page)).toHaveCount(0);
  const focused = await page.evaluate(() => document.activeElement?.tagName ?? 'NONE');
  expect(focused, 'focus must survive a move that leaves the law inapplicable').not.toBe('BODY');
});

test('the keyboard reaches every candidate control', async ({ page }) => {
  await selectLaw(page, laws.inverse);
  const total = await targets(page).count();

  const reached = new Set<string>();
  for (let press = 0; press < 40 && reached.size < total; press += 1) {
    await page.keyboard.press('Tab');
    const name = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '');
    if (/\. Option \d+ of \d+\.$/.test(name)) reached.add(name);
  }

  expect(reached.size, 'every target must be tabbable').toBe(total);
});

test('undo, redo and branching keep the proof consistent', async ({ page }) => {
  const pill = () => page.locator('.status-pill').innerText();

  await solve(page);
  await expect(page.locator('.status-pill')).toContainText('Complete');

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('Expression simplified')).toBeHidden();
  await page.getByRole('button', { name: 'Undo' }).click();
  expect(await pill()).toContain('2 steps');

  // Redo must still be available before branching, and gone afterwards.
  await expect(page.getByRole('button', { name: 'Redo' })).toBeEnabled();
  await selectLaw(page, laws.inverse);
  await applyTarget(page);
  await expect(
    page.getByRole('button', { name: 'Redo' }),
    'the abandoned future must not be reachable',
  ).toBeDisabled();

  await page.getByRole('button', { name: 'Restart' }).click();
  expect(await pill()).toContain('0 steps');
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
});

test('a law with no matches is explained rather than left silent', async ({ page }) => {
  await selectLaw(page, laws.identity);
  await expect(targets(page)).toHaveCount(0);

  const note = page.locator('.selection-note');
  await expect(note).toBeVisible();
  await expect(note).toContainText('Remove identity');
  await expect(note, 'a zero-match law is still a true law').toContainText(/still a true law/i);
});

test('the step detail is reachable without hovering', async ({ page }) => {
  await selectLaw(page, laws.inverse);
  await applyTarget(page);

  const reason = page.locator('.reason').first();
  // The visible label must be part of the accessible name (WCAG 2.5.3).
  await expect(reason).toHaveAccessibleName(/Inverse law/);
  await expect(reason).toHaveAttribute('aria-expanded', 'false');

  await reason.click();
  await expect(reason).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.reason-detail')).toContainText('is the identity');
});

test('the console stays clean through a complete proof', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(String(error)));

  await solve(page);
  expect(problems).toEqual([]);
});

test.describe('narrow viewport', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) > 500, 'phone project only');

  test('the sticky dock never covers the line being worked on', async ({ page }) => {
    expect(page.viewportSize()?.width, 'must be a true 390px CSS viewport').toBe(390);

    const box = async (selector: string) => page.locator(selector).first().boundingBox();

    for (const law of [laws.inverse, laws.identity, laws.inverse, laws.identity]) {
      await selectLaw(page, law);
      await applyTarget(page);
      await scrollSettled(page);

      const dock = (await box('.rules-card'))!;
      const current = (await box('.proof-line.is-current'))!;
      const viewport = page.viewportSize()!;

      expect(
        current.y + current.height,
        'the active line must clear the dock',
      ).toBeLessThanOrEqual(dock.y);
      expect(current.y, 'the active line must be on screen').toBeGreaterThanOrEqual(0);
      expect(current.y + current.height).toBeLessThanOrEqual(viewport.height);
    }

    // The completion note renders below the line, so it is what must clear the dock.
    const dock = (await box('.rules-card'))!;
    const success = (await box('.success-note'))!;
    expect(success.y + success.height).toBeLessThanOrEqual(dock.y);
  });

  test('the page never scrolls sideways', async ({ page }) => {
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });

  test('candidate controls meet the 44px touch target height', async ({ page }) => {
    await selectLaw(page, laws.inverse);
    const boxes = await targets(page).evaluateAll((els) =>
      els.map((el) => el.getBoundingClientRect().height),
    );
    expect(boxes.length).toBeGreaterThan(0);
    for (const height of boxes) expect(height).toBeGreaterThanOrEqual(44);
  });
});
