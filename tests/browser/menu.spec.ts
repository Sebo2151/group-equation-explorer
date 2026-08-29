import { expect, test, type Page } from '@playwright/test';

/**
 * The shell: where the app opens, how you get between the menu and a proof, and
 * the two things a view change must not break — losing a proof in progress, and
 * dropping focus.
 */

const heading = (page: Page, name: string) => page.getByRole('heading', { name });

const targets = (page: Page) => page.getByRole('button', { name: /\. Option \d+ of \d+\.$/ });

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

async function openChallenge(page: Page, label: string) {
  await expect(async () => {
    await page.getByRole('button', { name: new RegExp(`^Challenge ${label}:`) }).click();
    await expect(page.locator('.challenge-number')).toHaveText(label, { timeout: 1000 });
  }).toPass({ timeout: 15_000 });
}

/* Opening ---------------------------------------------------------------- */

test('the app opens on the menu, not in a proof', async ({ page }) => {
  await page.goto('/');
  await expect(heading(page, 'Choose something to prove')).toBeVisible();
  await expect(page.locator('.proof-card')).toHaveCount(0);
});

test('the menu lists every challenge and can start the first', async ({ page }) => {
  await page.goto('/');
  const entries = page.locator('.challenge-entry');
  await expect(entries).toHaveCount(19);

  await openChallenge(page, '01');
  await expect(heading(page, 'Cancel what undoes itself')).toBeVisible();
  await expect(page.locator('.proof-card')).toHaveCount(1);
});

/**
 * The menu enforces the order; a link does not. Somebody meant to send it, and
 * every challenge staying linkable is what this shell was built to guarantee —
 * so it opens, and says that the learner is ahead of the intended order.
 */
test('a locked challenge still opens by its own link, and says so', async ({ page }) => {
  await page.goto('/#challenge=socks-and-shoes');
  await expect(heading(page, 'Socks and shoes')).toBeVisible();
  await expect(page.locator('.challenge-number')).toHaveText('07');
  await expect(page.locator('.notice')).toContainText('jumped ahead');
});

test('a link naming no challenge lands on the menu rather than failing', async ({ page }) => {
  await page.goto('/#challenge=not-a-challenge');
  await expect(heading(page, 'Choose something to prove')).toBeVisible();
});

/* Getting back ------------------------------------------------------------ */

/**
 * The invariant that matters most here. Going to the menu to look something up
 * and coming back must not be the one action that throws away a proof.
 */
test('a proof in progress survives a trip to the menu and back', async ({ page }) => {
  await page.goto('/#challenge=cancel-pairs');
  await applyTarget(page);
  await applyTarget(page);
  const line = await page
    .locator('.proof-line.is-current [role=math]')
    .first()
    .getAttribute('aria-label');
  expect(await stepCount(page)).toBe(2);

  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(heading(page, 'Choose something to prove')).toBeVisible();

  await openChallenge(page, '01');
  expect(await stepCount(page), 'the proof was restarted').toBe(2);
  expect(
    await page.locator('.proof-line.is-current [role=math]').first().getAttribute('aria-label'),
  ).toBe(line);
});

test('the back button returns to the menu without restarting the proof', async ({ page }) => {
  await page.goto('/');
  await openChallenge(page, '01');
  await applyTarget(page);

  await page.goBack();
  await expect(heading(page, 'Choose something to prove')).toBeVisible();

  await page.goForward();
  await expect(page.locator('.challenge-number')).toHaveText('01');
  expect(await stepCount(page)).toBe(1);
});

test('returning to the menu puts focus on it', async ({ page }) => {
  await page.goto('/#challenge=cancel-pairs');
  await page.getByRole('button', { name: 'Menu' }).click();

  await expect(heading(page, 'Choose something to prove')).toBeFocused();
});

/* Help -------------------------------------------------------------------- */

test('help explains the app in general, and opens from its own link', async ({ page }) => {
  await page.goto('/#help');
  const help = page.locator('.help');
  await expect(help).toBeVisible();
  await expect(help).toContainText('one step at a time');
  await expect(help).toContainText('juxtaposition');

  // General orientation only: no walkthrough of any particular challenge.
  await expect(help).not.toContainText('Socks and shoes');
});

test('help can be opened and closed from the menu', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.help')).toHaveCount(0);

  // `exact`, because challenge 09 is called "Read it the other way".
  const toggle = page.getByRole('button', { name: 'Read it', exact: true });
  await expect(async () => {
    await toggle.click();
    await expect(page.locator('.help')).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });

  await page.getByRole('button', { name: 'Hide' }).click();
  await expect(page.locator('.help')).toHaveCount(0);
});

/* What the proof screen no longer carries -------------------------------- */

test('the proof screen carries no challenge picker or setup forms', async ({ page }) => {
  await page.goto('/#challenge=cancel-pairs');

  await expect(page.getByRole('combobox')).toHaveCount(0);
  await expect(page.getByLabel('Start from')).toHaveCount(0);
  await expect(page.getByLabel('Paste a proof record to replay it')).toHaveCount(0);
});

test('exporting stays with the proof it describes', async ({ page }) => {
  await page.goto('/#challenge=cancel-pairs');
  await expect(async () => {
    await page.getByRole('button', { name: 'Share' }).click();
    await expect(page.getByRole('button', { name: 'Copy proof record' })).toBeVisible({
      timeout: 1000,
    });
  }).toPass({ timeout: 15_000 });

  await expect(page.getByRole('button', { name: 'Copy LaTeX' })).toBeVisible();
  await expect(page.getByLabel('Paste a proof record to replay it')).toHaveCount(0);
});

/* Narrow viewport --------------------------------------------------------- */

test.describe('narrow viewport', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) > 500, 'phone project only');

  test('the menu does not scroll sideways', async ({ page }) => {
    await page.goto('/#help');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('a challenge entry meets the 44px touch target height', async ({ page }) => {
    await page.goto('/');
    const box = await page.getByRole('button', { name: /^Challenge 01:/ }).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });
});
