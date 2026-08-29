import { expect, test, type Page } from '@playwright/test';

import { PROOF_FORMAT, PROOF_VERSION } from '../../app/serialize.ts';
import { beginProof, revealLaw } from './briefing.ts';

/**
 * Phase 2 behaviour: parsed input, nested and gap targets, powers, per-challenge
 * rule gating, and export/import. Assertions are behavioural, so they should
 * survive a redesign of the bracket and dock treatment.
 */

const targets = (page: Page) => page.getByRole('button', { name: /\. Option \d+ of \d+\.$/ });

const lawButton = (page: Page, law: string) =>
  page.locator(`.rules-card .rule-card[aria-label^="${law},"]`);

/** Server-rendered markup means a click can land before hydration; retry. */
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

async function applyTarget(page: Page, index = 0) {
  const before = await stepCount(page);
  await expect(async () => {
    await targets(page).nth(index).click();
    expect(await stepCount(page)).toBe(before + 1);
  }).toPass({ timeout: 15_000 });
}

/** The challenge numbers, used to confirm the app actually arrived. */
const CHALLENGE_LABEL: Record<string, string> = {
  'cancel-pairs': '01',
  'insert-a-pair': '02',
  'prove-double-inverse': '04',
  'double-inverse': '05',
  'prove-socks-and-shoes': '06',
  'socks-and-shoes': '07',
  'nested-inverse': '08',
  powers: '09',
  free: '··',
};

/**
 * Navigation *within* the loaded app, by setting the fragment as a click would.
 *
 * Deliberately not `page.goto`: that reloads the document, which throws away
 * the drafts and the proof the app is holding. A test that reloads between two
 * assertions is testing a different thing from the one a learner does when they
 * press Menu.
 */
async function goTo(page: Page, hash: string) {
  await page.evaluate((value) => {
    window.location.hash = value;
  }, hash);
}

/**
 * The menu, hydrated.
 *
 * Filling a field before React attaches sets the DOM value and nothing else, so
 * pressing Start would use the default the component still holds. Toggling help
 * proves the handlers are live, and leaves the menu as it was found.
 */
async function openMenu(page: Page) {
  await goTo(page, '#menu');
  await expect(page.getByRole('heading', { name: 'Choose something to prove' })).toBeVisible();

  // `exact`, because challenge 09 is called "Read it the other way".
  const toggle = page.getByRole('button', { name: 'Read it', exact: true });
  await expect(async () => {
    await toggle.click();
    await expect(page.locator('.help')).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Hide' }).click();
  await expect(page.locator('.help')).toHaveCount(0);
}

/**
 * Navigation is by URL fragment, so a challenge is reachable directly. The
 * challenge number confirms the app actually arrived: asserting the fragment
 * would only confirm the test's own input.
 */
async function chooseChallenge(page: Page, value: string) {
  await goTo(page, value === 'free' ? '#free' : `#challenge=${value}`);
  await beginProof(page);
  await expect(page.locator('.challenge-number')).toHaveText(CHALLENGE_LABEL[value], {
    timeout: 15_000,
  });
}

/** Fill the free-exploration form on the menu and start, landing on the sheet. */
async function startFree(page: Page, start: string, goal = '') {
  await openMenu(page);
  await page.getByLabel('Start from').fill(start);
  await page.getByLabel('Goal (optional)').fill(goal);
  await expect(async () => {
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(page.locator('.challenge-number')).toHaveText('\u00b7\u00b7', { timeout: 1000 });
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

// Taken from the app's own constants so a format bump cannot silently leave
// this fixture testing nothing but the version check.
const SOCKS_RECORD = {
  format: PROOF_FORMAT,
  version: PROOF_VERSION,
  challenge: 'socks-and-shoes',
  start: '(a b)^-1 a',
  goal: 'b^-1',
  ruleset: ['inverse-of-product', 'cancel-inverse', 'remove-identity'],
  steps: [
    { rule: 'inverse-of-product', path: [], start: 0, end: 0 },
    { rule: 'cancel-inverse', path: [], start: 1, end: 2 },
  ],
};

test.beforeEach(async ({ page }) => {
  await page.goto('/#challenge=cancel-pairs');
  await beginProof(page);
  await expect(page.getByRole('heading', { name: 'Build an equality chain' })).toBeVisible();
  await ready(page);
});

/* Challenges and gating -------------------------------------------------- */

test('a challenge offers only the laws it permits', async ({ page }) => {
  await chooseChallenge(page, 'cancel-pairs');
  const first = await page.locator('.rules-card .rule-card').count();

  await chooseChallenge(page, 'powers');
  const laws = await page
    .locator('.rules-card .rule-card')
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
  await startFree(page, 'a^-1');

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
  await openMenu(page);

  const start = page.getByLabel('Start from');
  await start.fill('(ab');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.notice.is-error')).toContainText('closing parenthesis');
  await expect(
    page.getByRole('heading', { name: 'Choose something to prove' }),
    'a rejected start must not open a proof',
  ).toBeVisible();

  await startFree(page, '(r2 s)^-1 r2^2');
  expect(await currentLine(page)).toBe(
    'the inverse of, r2 times s, end inverse times r2 to the power 2',
  );
  await expect(page.locator('.status-pill')).toContainText('0 steps');
});

for (const label of ['Start from', 'Goal (optional)']) {
  test(`an invalid ${label} draft can be reopened and repaired`, async ({ page }) => {
    await startFree(page, 'a a^-1 b');
    await applyTarget(page);
    const committed = await currentLine(page);

    // The draft is left unfinished on the menu, and a different challenge is
    // worked in between. Neither the text nor the free proof may be lost.
    await openMenu(page);
    await page.getByLabel(label).fill('(');
    await chooseChallenge(page, 'powers');
    await openMenu(page);
    await expect(page.getByLabel(label)).toHaveValue('(');

    await chooseChallenge(page, 'free');
    expect(await currentLine(page)).toBe(committed);
    expect(await stepCount(page)).toBe(1);

    await openMenu(page);
    await page.getByLabel(label).fill('b');
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    expect(await stepCount(page)).toBe(0);
    await expect(page.locator('.notice.is-error')).toHaveCount(0);
  });
}

test('no accessible name contains TeX, on a nested expression with powers', async ({ page }) => {
  await startFree(page, '((a b^-1)^2 c)^-1 r2^-3');
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
  await openMenu(page);
  await page.getByLabel('Paste a proof record to replay it').fill(JSON.stringify(SOCKS_RECORD));
  await page.getByRole('button', { name: 'Import and check' }).click();

  await expect(page.locator('.notice.is-ok')).toContainText('imported and replayed');
  // A record that checks out opens the proof it describes.
  expect(await stepCount(page)).toBe(2);
  expect(await currentLine(page)).toBe('b inverse times identity e');
});

test('a tampered record is refused and leaves the current proof alone', async ({ page }) => {
  await openMenu(page);

  const tampered = {
    ...SOCKS_RECORD,
    steps: [{ rule: 'cancel-inverse', path: [], start: 0, end: 1 }],
  };
  await page.getByLabel('Paste a proof record to replay it').fill(JSON.stringify(tampered));
  await page.getByRole('button', { name: 'Import and check' }).click();

  await expect(page.locator('.notice.is-error')).toContainText('does not check out');
  await expect(
    page.getByRole('heading', { name: 'Choose something to prove' }),
    'a refused import must not open anything',
  ).toBeVisible();

  await chooseChallenge(page, 'cancel-pairs');
  expect(await stepCount(page), 'the refused import must not replace the proof').toBe(0);
});

test('a record claiming a challenge cannot smuggle in extra tools', async ({ page }) => {
  await openMenu(page);

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

  // A link that will not open leaves the learner on the menu, which is
  // somewhere to go from, rather than on an empty proof screen.
  await expect(page.getByRole('heading', { name: 'Choose something to prove' })).toBeVisible();
  await chooseChallenge(page, 'cancel-pairs');
  expect(await stepCount(page), 'the app must still be usable').toBe(0);
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

for (const label of ['Start from', 'Goal (optional)', 'Insert this term', 'Paste a proof record to replay it']) {
  test(`native text undo and redo in ${label} leave the proof alone`, async ({ page }) => {
    // `Insert this term` is on the sheet; the other fields are on the menu.
    // Either way the proof must be unaffected, so where the field lives only
    // changes where the proof has to be looked at afterwards.
    const onSheet = label === 'Insert this term';
    if (onSheet) {
      await chooseChallenge(page, 'insert-a-pair');
    } else {
      await startFree(page, 'a a^-1 b');
    }
    await applyTarget(page);
    const committed = await currentLine(page);
    if (!onSheet) await openMenu(page);

    const field = page.getByLabel(label);
    await field.fill('');
    await field.pressSequentially('abc');
    await field.press('Control+z');
    await expect(field).not.toHaveValue('abc');
    await field.press('Control+Shift+z');
    await expect(field).toHaveValue('abc');

    if (!onSheet) await chooseChallenge(page, 'free');
    expect(await stepCount(page), 'editing text moved the proof').toBe(1);
    expect(await currentLine(page)).toBe(committed);
  });
}

/* Narrow viewport -------------------------------------------------------- */

test.describe('narrow viewport', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) > 500, 'phone project only');

  test('switching to a taller dock immediately keeps the new proof visible', async ({ page }) => {
    const openingHeight = (await page.locator('.rules-card').boundingBox())!.height;
    await startFree(page, 'a a^-1 b');
    await scrollSettled(page);
    const dock = (await page.locator('.rules-card').boundingBox())!;
    const current = (await page.locator('.proof-line.is-current').boundingBox())!;
    expect(dock.height).toBeGreaterThan(openingHeight);
    expect(current.y).toBeGreaterThanOrEqual(0);
    expect(current.y + current.height).toBeLessThanOrEqual(dock.y);
  });

  for (const width of [390, 320]) {
    test(`long previews scroll locally at ${width}px without widening the page`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      const pageFits = () => page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      );
      expect(await pageFits(), 'the sheet must fit to begin with').toBe(true);

      await openMenu(page);
      for (const label of ['Start from', 'Goal (optional)']) {
        await page.getByLabel(label).fill('a'.repeat(40));
        expect(await pageFits(), 'a long draft must not widen the menu').toBe(true);
      }
      const preview = page.locator('.free-field .field-preview').first();
      expect(await preview.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);

      await startFree(page, 'a a^-1 b');
      await selectLaw(page, 'Insert inverse pair');
      await page.getByLabel('Insert this term').fill('a'.repeat(40));
      expect(await pageFits()).toBe(true);
      expect(await page.locator('.instantiation .field-preview').evaluate(
        (el) => el.scrollWidth > el.clientWidth,
      )).toBe(true);
    });
  }

  test('the dock still clears the active line with the whole catalogue open', async ({ page }) => {
    // Free exploration permits every law, so the dock is at its tallest — far
    // taller than the two-law dock the Phase 1 test measures. The proof also has
    // to grow enough to push the active line down the page, or the reservation
    // is never under any pressure and the test proves nothing.
    await startFree(page, 'a a^-1 b b^-1 c c^-1');

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
    await startFree(page, '((a b^-1)^2 c)^-1 r2^-3 s s^-1');

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });
});
