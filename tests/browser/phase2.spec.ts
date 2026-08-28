import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 2 behaviour: parsed input, nested and gap targets, powers, per-challenge
 * rule gating, and export/import. Assertions are behavioural, so they should
 * survive a redesign of the bracket and dock treatment.
 */

const targets = (page: Page) => page.getByRole('button', { name: /\. Option \d+ of \d+\.$/ });

const lawButton = (page: Page, law: string) =>
  page.getByRole('complementary').getByRole('button', { name: new RegExp(`^${law}, \\d+ place`) });

/** Server-rendered markup means a click can land before hydration; retry. */
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

async function applyTarget(page: Page, index = 0) {
  const before = await stepCount(page);
  await expect(async () => {
    await targets(page).nth(index).click();
    expect(await stepCount(page)).toBe(before + 1);
  }).toPass({ timeout: 15_000 });
}

/**
 * The challenge numbers, used to confirm that a change of challenge actually
 * reached the app. Confirming the select's own value would only confirm the
 * test's input: `selectOption` sets it whether or not React is listening yet.
 */
const CHALLENGE_LABEL: Record<string, string> = {
  'cancel-pairs': '01',
  'insert-a-pair': '02',
  'double-inverse': '03',
  'socks-and-shoes': '04',
  'nested-inverse': '05',
  powers: '06',
  free: '··',
};

async function chooseChallenge(page: Page, value: string) {
  const picker = page.getByRole('combobox');
  await expect(async () => {
    await picker.selectOption(value);
    await expect(page.locator('.challenge-number')).toHaveText(CHALLENGE_LABEL[value], {
      timeout: 1000,
    });
  }).toPass({ timeout: 15_000 });
}

async function openShare(page: Page) {
  const button = page.getByRole('button', { name: 'Share' });
  await expect(async () => {
    await button.click();
    await expect(button).toHaveAttribute('aria-expanded', 'true', { timeout: 1000 });
  }).toPass({ timeout: 15_000 });
}

/**
 * The markup is server-rendered, and several controls already carry their
 * eventual state in that markup — the first law is `aria-pressed` before any
 * script runs, and `selectOption` sets a select's value whether or not React is
 * listening. Asserting on those cannot distinguish "hydrated" from "not yet".
 *
 * So gate on a state change no server render can have produced: toggle the
 * reasons and watch the control's own label change, then put it back. It is
 * deliberately unrelated to anything under test, so a broken feature fails its
 * own assertion rather than every test's setup.
 */
async function ready(page: Page) {
  const toggle = page.getByRole('button', { name: /reasons$/ });
  await expect(async () => {
    await toggle.click();
    await expect(toggle).toHaveAccessibleName('Show reasons', { timeout: 1000 });
  }).toPass({ timeout: 15_000 });

  await toggle.click();
  await expect(toggle).toHaveAccessibleName('Hide reasons');
}

/**
 * Scrolling is smooth and starts asynchronously, so sampling a couple of frames
 * after a move can catch the page before it has begun to move. Require the
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

/** The current line, read from its accessible name rather than its markup. */
async function currentLine(page: Page) {
  return page.locator('.proof-line.is-current [role=math]').first().getAttribute('aria-label');
}

function shareLink(record: unknown): string {
  const encoded = Buffer.from(JSON.stringify(record), 'utf8').toString('base64url');
  return `/#proof=${encoded}`;
}

const SOCKS_RECORD = {
  format: 'group-equation-explorer/proof',
  version: 1,
  challenge: 'socks-and-shoes',
  start: '(a b)^-1 a b',
  goal: 'e',
  ruleset: ['inverse-of-product', 'cancel-inverse', 'remove-identity'],
  steps: [
    { rule: 'inverse-of-product', path: [], start: 0, end: 0 },
    { rule: 'cancel-inverse', path: [], start: 1, end: 2 },
  ],
};

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Build an equality chain' })).toBeVisible();
  await ready(page);
});

/* Challenges and gating -------------------------------------------------- */

test('a challenge offers only the laws it permits', async ({ page }) => {
  await chooseChallenge(page, 'cancel-pairs');
  const first = await page.getByRole('complementary').getByRole('button').count();

  await chooseChallenge(page, 'powers');
  const laws = await page
    .getByRole('complementary')
    .getByRole('button')
    .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));

  expect(laws.length).toBeGreaterThan(first);
  expect(laws.some((law) => law?.startsWith('Combine powers'))).toBe(true);
  // Socks and shoes is not among this challenge's tools, so it is not offered.
  expect(laws.some((law) => law?.startsWith('Distribute an inverse'))).toBe(false);
});

test('changing challenge resets the proof to that challenge', async ({ page }) => {
  await selectLaw(page, 'Cancel inverse pair');
  await applyTarget(page);
  expect(await stepCount(page)).toBe(1);

  await chooseChallenge(page, 'double-inverse');
  expect(await stepCount(page)).toBe(0);
  expect(await currentLine(page)).toBe(
    'the inverse of, a inverse, end inverse times b inverse times b',
  );
});

/* Nested targets --------------------------------------------------------- */

test('a control reaches inside a nested inverse and rewrites only there', async ({ page }) => {
  await chooseChallenge(page, 'nested-inverse');
  await selectLaw(page, 'Distribute an inverse');

  await expect(targets(page)).toHaveCount(1);
  await applyTarget(page);

  expect(await currentLine(page)).toBe('the inverse of, b inverse, end inverse times a inverse');

  await selectLaw(page, 'Undo a double inverse');
  await applyTarget(page);
  expect(await currentLine(page)).toBe('b times a inverse');
  await expect(page.getByText('Expression simplified')).toBeVisible();
});

test('a bracket covers exactly the sub-expression it applies to', async ({ page }) => {
  await selectLaw(page, 'Cancel inverse pair');

  const geometry = await page.evaluate(() => {
    const stage = document.querySelector('.expression-stage')!;
    const factors = [...stage.querySelectorAll('.factor')].map((node) => {
      const box = node.getBoundingClientRect();
      return [box.left, box.right];
    });
    const control = stage.querySelector('button.target')!.getBoundingClientRect();
    return { factors, control: [control.left, control.right] };
  });

  // The first control covers `a a^-1`: three tokens, since the superscript is
  // its own column. Allow a couple of pixels for the control's own inset.
  const spanned = geometry.factors.slice(0, 3);
  expect(geometry.control[0]).toBeGreaterThanOrEqual(spanned[0][0] - 3);
  expect(geometry.control[0]).toBeLessThanOrEqual(spanned[0][0] + 6);
  expect(geometry.control[1]).toBeGreaterThanOrEqual(spanned[2][1] - 6);
  expect(geometry.control[1]).toBeLessThanOrEqual(spanned[2][1] + 3);
});

/* Insertion -------------------------------------------------------------- */

test('an insertion rule marks the gaps and needs a term', async ({ page }) => {
  await chooseChallenge(page, 'insert-a-pair');
  await selectLaw(page, 'Insert inverse pair');

  // `b` alone has a gap either side of it.
  await expect(targets(page)).toHaveCount(2);
  await expect(targets(page).nth(0)).toHaveAccessibleName(/before b/);
  await expect(targets(page).nth(1)).toHaveAccessibleName(/after b/);

  const field = page.getByLabel('Insert this term');
  await field.fill('a +');
  await expect(page.locator('.instantiation .field-preview.is-error')).toContainText(
    'Unexpected character',
  );
  await expect(targets(page).first(), 'a control must not commit an unreadable term').toBeDisabled();

  await field.fill('a');
  await expect(targets(page).first()).toBeEnabled();
  await page.getByLabel(/Inverse first/).check();
  await applyTarget(page, 0);

  expect(await currentLine(page)).toBe('a inverse times a times b');
  await expect(page.getByText('Expression simplified')).toBeVisible();
});

test('insertion points at the same place but different depths are separate controls', async ({
  page,
}) => {
  await chooseChallenge(page, 'free');
  await page.getByLabel('Start from').fill('a^-1');
  await page.getByLabel('Goal (optional)').fill('');
  await page.getByRole('button', { name: 'Start', exact: true }).click();

  await selectLaw(page, 'Insert identity');

  const names = await targets(page).evaluateAll((els) =>
    els.map((el) => el.getAttribute('aria-label')),
  );
  // Two gaps around the whole inverse, two around the `a` inside it.
  expect(names).toHaveLength(4);
  expect(new Set(names).size, 'controls must be distinguishable').toBe(4);

  const rows = await targets(page).evaluateAll((els) =>
    els.map((el) => (el as HTMLElement).style.gridRow),
  );
  expect(new Set(rows).size, 'coinciding controls must be on different rows').toBeGreaterThan(1);
});

/* Powers ----------------------------------------------------------------- */

test('powers combine, and can also be written out instead', async ({ page }) => {
  await chooseChallenge(page, 'powers');

  await selectLaw(page, 'Combine powers');
  await applyTarget(page);
  expect(await currentLine(page)).toBe('a');
  await expect(page.getByText('Expression simplified')).toBeVisible();

  await page.getByRole('button', { name: 'Restart' }).click();
  await selectLaw(page, 'Write a power out');
  await applyTarget(page);
  expect(await currentLine(page)).toContain('a times a times a');
});

/* Free exploration ------------------------------------------------------- */

test('free exploration parses input and refuses what it cannot read', async ({ page }) => {
  await chooseChallenge(page, 'free');

  const start = page.getByLabel('Start from');
  await start.fill('(ab');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.notice.is-error')).toContainText('closing parenthesis');
  expect(await stepCount(page), 'a rejected start must not disturb the proof').toBe(0);

  await start.fill('(r2 s)^-1 r2^2');
  await page.getByLabel('Goal (optional)').fill('');
  await page.getByRole('button', { name: 'Start', exact: true }).click();

  expect(await currentLine(page)).toBe(
    'the inverse of, r2 times s, end inverse times r2 to the power 2',
  );
  await expect(page.locator('.status-pill')).toContainText('0 steps');
});

test('no accessible name contains TeX, on a nested expression with powers', async ({ page }) => {
  await chooseChallenge(page, 'free');
  await page.getByLabel('Start from').fill('((a b^-1)^2 c)^-1 r2^-3');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await selectLaw(page, 'Distribute an inverse');

  const names = await page
    .locator('[aria-label], [role=math]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? ''));

  for (const value of names) {
    expect(value, `TeX leaked into "${value}"`).not.toMatch(/[\\^{}]|\$/);
  }
});

/* Export, import, and links ---------------------------------------------- */

test('a pasted proof record is replayed before it is shown', async ({ page }) => {
  await openShare(page);
  await page.getByLabel('Paste a proof record to replay it').fill(JSON.stringify(SOCKS_RECORD));
  await page.getByRole('button', { name: 'Import and check' }).click();

  await expect(page.locator('.notice.is-ok')).toContainText('imported and replayed');
  expect(await stepCount(page)).toBe(2);
  expect(await currentLine(page)).toBe('b inverse times identity e times b');
});

test('a tampered record is refused and leaves the current proof alone', async ({ page }) => {
  await openShare(page);

  const tampered = {
    ...SOCKS_RECORD,
    steps: [{ rule: 'cancel-inverse', path: [], start: 0, end: 1 }],
  };
  await page.getByLabel('Paste a proof record to replay it').fill(JSON.stringify(tampered));
  await page.getByRole('button', { name: 'Import and check' }).click();

  await expect(page.locator('.notice.is-error')).toContainText('does not check out');
  expect(await stepCount(page), 'the refused import must not replace the proof').toBe(0);
});

test('a record claiming a challenge cannot smuggle in extra tools', async ({ page }) => {
  await openShare(page);

  const overreaching = { ...SOCKS_RECORD, ruleset: [...SOCKS_RECORD.ruleset, 'combine-powers'] };
  await page.getByLabel('Paste a proof record to replay it').fill(JSON.stringify(overreaching));
  await page.getByRole('button', { name: 'Import and check' }).click();

  await expect(page.locator('.notice.is-error')).toContainText('does not permit');
});

/**
 * The fragment is read once at mount, so the page has to actually mount with it
 * in place. Navigating from `/` to `/#proof=…` is a same-document hash change
 * and would not remount anything.
 */
async function openLink(page: Page, record: unknown) {
  await page.goto(shareLink(record));
  await page.reload();
}

test('a shared link opens the proof it carries', async ({ page }) => {
  await openLink(page, SOCKS_RECORD);
  await expect(page.locator('.notice.is-ok')).toContainText('Opened the proof from this link');
  expect(await stepCount(page)).toBe(2);
});

test('a corrupt link says so rather than showing half a proof', async ({ page }) => {
  await openLink(page, { ...SOCKS_RECORD, start: 'a + b' });
  await expect(page.locator('.notice.is-error')).toContainText('did not open');
  expect(await stepCount(page), 'the default challenge must still be usable').toBe(0);
});

/* Keyboard --------------------------------------------------------------- */

test('a digit applies the candidate with that number', async ({ page }) => {
  await selectLaw(page, 'Cancel inverse pair');
  await expect(targets(page)).toHaveCount(2);

  await targets(page).first().focus();
  await page.keyboard.press('2');

  expect(await stepCount(page)).toBe(1);
  expect(await currentLine(page)).toBe('a times a inverse times b times identity e');
});

test('arrow keys move between candidates without leaving the expression', async ({ page }) => {
  await selectLaw(page, 'Cancel inverse pair');
  await targets(page).first().focus();

  await page.keyboard.press('ArrowRight');
  await expect(page.locator(':focus')).toHaveAccessibleName(/Option 2 of 2/);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator(':focus'), 'focus wraps rather than escaping').toHaveAccessibleName(
    /Option 1 of 2/,
  );
});

test('ctrl+z undoes and ctrl+shift+z redoes', async ({ page }) => {
  await selectLaw(page, 'Cancel inverse pair');
  await applyTarget(page);
  expect(await stepCount(page)).toBe(1);

  await page.keyboard.press('Control+z');
  expect(await stepCount(page)).toBe(0);

  await page.keyboard.press('Control+Shift+z');
  expect(await stepCount(page)).toBe(1);
});

/* Narrow viewport -------------------------------------------------------- */

test.describe('narrow viewport', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) > 500, 'phone project only');

  test('the dock still clears the active line with the whole catalogue open', async ({ page }) => {
    // Free exploration permits every law, so the dock is at its tallest — far
    // taller than the two-law dock the Phase 1 test measures. The proof also has
    // to grow enough to push the active line down the page, or the reservation
    // is never under any pressure and the test proves nothing.
    await chooseChallenge(page, 'free');
    await page.getByLabel('Start from').fill('a a^-1 b b^-1 c c^-1');
    await page.getByLabel('Goal (optional)').fill('');
    await page.getByRole('button', { name: 'Start', exact: true }).click();

    const laws = ['Cancel inverse pair', 'Cancel inverse pair', 'Cancel inverse pair'];
    for (const law of laws) {
      await selectLaw(page, law);
      await applyTarget(page);
    }
    await selectLaw(page, 'Remove identity');
    await applyTarget(page);
    await applyTarget(page);

    await scrollSettled(page);

    const dock = (await page.locator('.rules-card').boundingBox())!;
    const current = (await page.locator('.proof-line.is-current').boundingBox())!;

    expect(dock.height, 'the whole catalogue must make a tall dock').toBeGreaterThan(150);
    expect(current.y + current.height, 'the active line must clear the dock').toBeLessThanOrEqual(
      dock.y,
    );
    expect(current.y, 'the active line must be on screen').toBeGreaterThanOrEqual(0);
  });

  test('the page never scrolls sideways on a long nested expression', async ({ page }) => {
    await chooseChallenge(page, 'free');
    await page.getByLabel('Start from').fill('((a b^-1)^2 c)^-1 r2^-3 s s^-1');
    await page.getByRole('button', { name: 'Start', exact: true }).click();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });
});
