import { expect, test } from '@playwright/test';
import { beginProof } from './briefing.ts';
import { startPagesServer, stopPagesServer } from '../support/serve-pages.ts';

const SITE_PATH = '/group-equation-explorer/';

let server: Awaited<ReturnType<typeof startPagesServer>>;

test.beforeAll(async () => {
  server = await startPagesServer();
});

test.afterAll(async () => {
  await stopPagesServer(server);
});

test('the exported app boots and works at the GitHub Pages project path', async ({ page }) => {
  const failures: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => failures.push(`page: ${error.message}`));
  page.on('response', (response) => {
    if (response.status() >= 400) failures.push(`${response.status()}: ${response.url()}`);
  });

  const response = await page.goto(`${SITE_PATH}#challenge=cancel-pairs`, {
    waitUntil: 'networkidle',
  });
  expect(response?.status()).toBe(200);

  await beginProof(page);
  await expect(page.locator('.proof-card')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${SITE_PATH.replaceAll('/', '\\/')}#challenge=cancel-pairs$`));

  const socialCard = await page.request.get(`${SITE_PATH}og.png`);
  expect(socialCard.status()).toBe(200);
  expect(socialCard.headers()['content-type']).toBe('image/png');
  await socialCard.dispose();
  expect(failures).toEqual([]);
});
