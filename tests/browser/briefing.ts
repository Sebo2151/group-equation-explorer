import { expect, type Locator, type Page } from '@playwright/test';

/** Enter the workbench when a challenge has presented its first-visit briefing. */
export async function beginProof(page: Page) {
  const begin = page.getByRole('button', { name: 'Begin proof' });
  const sheet = page.locator('.proof-card');
  await expect(begin.or(sheet)).toBeVisible({ timeout: 15_000 });
  if (!(await begin.isVisible())) return;

  await expect(async () => {
    await begin.click();
    await expect(sheet).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
}

/** Open the purpose group that contains a law before trying to select it. */
export async function revealLaw(button: Locator) {
  const group = button.locator('xpath=ancestor::details[1]');
  if ((await group.getAttribute('open')) !== null) return;
  await group.locator('summary').click();
  await expect(button).toBeVisible();
}
