import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 3a: a proof line can be an equation.
 *
 * The invariants that matter here are the ones the equation introduces —
 * candidates on both sides of the relation stay distinguishable and are
 * numbered in reading order, and a law that acts on the whole line is offered
 * as something other than a bracket. Assertions are behavioural, so a redesign
 * of the pill or the bracket should not disturb them.
 */

const targets = (page: Page) => page.getByRole('button', { name: /\. Option \d+ of \d+\.$/ });

const wholeLine = (page: Page) =>
  page.getByRole('button', { name: /\. Applies to the whole equation\.$/ });

const lawButton = (page: Page, law: string) =>
  page.getByRole('complementary').getByRole('button', { name: new RegExp(`^${law},`) });

async function selectLaw(page: Page, law: string) {
  const button = lawButton(page, law);
  await expect(async () => {
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true', { timeout: 1000 });
  }).toPass({ timeout: 15_000 });
}

async function stepCount(page: Page) {
  const text = await page.locator('.status-pill').innerText();
  return Number(text.match(/\d+/)?.[0] ?? 0);
}

async function currentLine(page: Page) {
  return page.locator('.proof-line.is-current [role=math]').first().getAttribute('aria-label');
}

/** Open free exploration on a given start, with no goal unless one is given. */
async function startFree(page: Page, start: string, goal = '') {
  const picker = page.getByRole('combobox');
  await expect(async () => {
    await picker.selectOption('free');
    await expect(page.locator('.challenge-number')).toHaveText('··', { timeout: 1000 });
  }).toPass({ timeout: 15_000 });

  await page.getByLabel('Start from').fill(start);
  await page.getByLabel('Goal (optional)').fill(goal);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.notice.is-error')).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Build an equality chain' })).toBeVisible();
});

/* Entering an equation --------------------------------------------------- */

test('an equation can be typed, and reads as an equation', async ({ page }) => {
  await startFree(page, 'a x = b');
  expect(await currentLine(page)).toBe('a times x equals b');
  await expect(page.locator('.status-pill')).toContainText('0 steps');
});

test('a start and goal must agree about being equations', async ({ page }) => {
  const picker = page.getByRole('combobox');
  await expect(async () => {
    await picker.selectOption('free');
    await expect(page.locator('.challenge-number')).toHaveText('··', { timeout: 1000 });
  }).toPass({ timeout: 15_000 });

  await page.getByLabel('Start from').fill('a x = b');
  await page.getByLabel('Goal (optional)').fill('b');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.notice.is-error')).toContainText('both equations');
});

test('an equation with two relations is refused', async ({ page }) => {
  const picker = page.getByRole('combobox');
  await expect(async () => {
    await picker.selectOption('free');
    await expect(page.locator('.challenge-number')).toHaveText('··', { timeout: 1000 });
  }).toPass({ timeout: 15_000 });

  await page.getByLabel('Start from').fill('a = b = c');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.notice.is-error')).toContainText('one equals sign');
});

/* Local rewrites on either side ------------------------------------------ */

test('a law finds targets on both sides, numbered left to right', async ({ page }) => {
  await startFree(page, 'a a^-1 = b b^-1');
  await selectLaw(page, 'Cancel inverse pair');

  await expect(targets(page)).toHaveCount(2);
  await expect(targets(page).nth(0)).toHaveAccessibleName(
    'Cancel inverse pair at a times a inverse, on the left. Option 1 of 2.',
  );
  await expect(targets(page).nth(1)).toHaveAccessibleName(
    'Cancel inverse pair at b times b inverse, on the right. Option 2 of 2.',
  );
});

/**
 * The reason the side is named at all. Identical spans on opposite sides would
 * otherwise announce identically, and two candidates that cannot be told apart
 * is what the one-control-per-candidate invariant exists to prevent.
 */
test('identical spans on opposite sides remain distinguishable', async ({ page }) => {
  await startFree(page, 'a a^-1 = a a^-1');
  await selectLaw(page, 'Cancel inverse pair');

  const names = await targets(page).evaluateAll((els) =>
    els.map((el) => el.getAttribute('aria-label')),
  );
  expect(names).toHaveLength(2);
  expect(new Set(names).size, 'candidates on opposite sides must differ').toBe(2);
});

test('a rewrite changes only the side it was aimed at', async ({ page }) => {
  await startFree(page, 'a a^-1 = b b^-1');
  await selectLaw(page, 'Cancel inverse pair');
  await targets(page).nth(1).click();

  expect(await stepCount(page)).toBe(1);
  expect(await currentLine(page)).toBe('a times a inverse equals identity e');
});

/* Whole-equation laws ---------------------------------------------------- */

test('a whole-equation law is offered as a control on the line, not a bracket', async ({
  page,
}) => {
  await startFree(page, 'a x = b');
  await selectLaw(page, 'Swap the sides');

  await expect(wholeLine(page)).toHaveCount(1);
  await expect(targets(page), 'a whole-equation law must draw no brackets').toHaveCount(0);
  await expect(wholeLine(page)).toHaveAccessibleName('Swap the sides. Applies to the whole equation.');
});

test('the law list advertises a whole-equation law without a count of places', async ({ page }) => {
  await startFree(page, 'a x = b');
  const name = await lawButton(page, 'Swap the sides').getAttribute('aria-label');
  expect(name).toContain('whole equation');
  expect(name, 'a whole-equation law has no places to choose among').not.toMatch(/\d+ place/);
});

test('swapping the sides is a justified step like any other', async ({ page }) => {
  await startFree(page, 'a x = b');
  await selectLaw(page, 'Swap the sides');
  await wholeLine(page).click();

  expect(await stepCount(page)).toBe(1);
  expect(await currentLine(page)).toBe('b equals a times x');
  await expect(page.locator('.proof-line .reason').last()).toContainText('Symmetry');
});

/**
 * The catalogue stays visible — a learner should be able to see the whole
 * toolkit — but a whole-equation law aimed at an expression is inapplicable in
 * kind rather than merely unmatched, so it says what it needs instead of
 * reporting zero places, and offers no control.
 */
test('a whole-equation law on an expression says what it needs and offers nothing', async ({
  page,
}) => {
  await startFree(page, 'a a^-1 b');

  const law = lawButton(page, 'Swap the sides');
  await expect(law).toHaveAccessibleName('Swap the sides, needs an equation');

  await selectLaw(page, 'Swap the sides');
  await expect(wholeLine(page)).toHaveCount(0);
  await expect(targets(page)).toHaveCount(0);
  await expect(page.locator('.selection-note')).toContainText('not an equation');
});

/* Goal matching ---------------------------------------------------------- */

/**
 * The decision that symmetry stays a step worth taking: reaching the goal with
 * the sides the other way round is not yet reaching the goal.
 */
test('an equation goal is orientation sensitive', async ({ page }) => {
  await startFree(page, 'b = a x', 'a x = b');
  await expect(page.locator('.status-pill')).not.toHaveClass(/is-complete/);

  await selectLaw(page, 'Swap the sides');
  await wholeLine(page).click();

  await expect(page.locator('.status-pill')).toHaveClass(/is-complete/);
});

/* Accessibility and geometry --------------------------------------------- */

test('no accessible name contains TeX, on an equation', async ({ page }) => {
  await startFree(page, '(a b)^-1 a^2 = x^-3');
  await selectLaw(page, 'Cancel inverse pair');

  const names = await page.locator('[aria-label]').evaluateAll((els) =>
    els.map((el) => el.getAttribute('aria-label') ?? ''),
  );
  for (const name of names) {
    expect(name, `TeX leaked into an accessible name: ${name}`).not.toMatch(/[\\{}^]/);
  }
});

test.describe('narrow viewport', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) > 500, 'phone project only');

  test('an equation does not make the page scroll sideways', async ({ page }) => {
    await startFree(page, '(a b)^-1 a b = x x^-1 x');

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, 'the page itself must not scroll sideways').toBeLessThanOrEqual(0);
  });

  test('the whole-equation control meets the 44px touch target height', async ({ page }) => {
    await startFree(page, 'a x = b');
    await selectLaw(page, 'Swap the sides');

    const box = await wholeLine(page).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });
});
