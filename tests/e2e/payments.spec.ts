import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
let build: string;
let profile: string;
let context: BrowserContext;
test.beforeAll(async () => {
  build = await mkdtemp(join(tmpdir(), 'page-monitor-paid-build-'));
  execFileSync(
    process.execPath,
    [resolve('node_modules/vite/bin/vite.js'), 'build', '--outDir', build],
    {
      env: { ...process.env, VITE_EXTPAY_EXTENSION_ID: 'payment-fixture' },
      stdio: 'pipe',
    },
  );
});
test.afterAll(async () => {
  if (build) await rm(build, { recursive: true, force: true });
});
test.afterEach(async () => {
  await context?.close();
  if (profile) await rm(profile, { recursive: true, force: true });
});
test('bundled SDK opens exact-price checkout, verifies payment and restores locally', async () => {
  profile = await mkdtemp(join(tmpdir(), 'page-monitor-paid-profile-'));
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${build}`,
      `--load-extension=${build}`,
      '--host-resolver-rules=MAP * ~NOTFOUND',
      '--disable-background-networking',
    ],
  });
  await context.route('https://**/*', (route) => {
    const url = new URL(route.request().url());
    if (
      url.origin === 'https://extensionpay.com' &&
      [
        '/extension/payment-fixture/choose-plan',
        '/extension/payment-fixture/reactivate',
      ].includes(url.pathname)
    )
      return route.fulfill({
        contentType: 'text/html',
        body: '<title>Payment fixture</title>',
      });
    return route.abort();
  });
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  await worker.evaluate(() => {
    // Replace the HTTP boundary in the real worker before the first provider action.
    // DNS is blocked too, including any unexpected worker request.
    globalThis.fetch = async (input, init) => {
      if (!(init?.signal instanceof AbortSignal))
        throw new Error('Provider requests must be abortable');
      const url = String(input);
      if (
        url ===
        'https://extensionpay.com/extension/payment-fixture/api/v2/current-plans'
      )
        return Response.json([
          { interval: 'once', unitAmountCents: 299, currency: 'usd' },
        ]);
      if (
        url === 'https://extensionpay.com/extension/payment-fixture/api/new-key'
      )
        return Response.json('fixture-key');
      if (
        url ===
        'https://extensionpay.com/extension/payment-fixture/api/v2/user?api_key=fixture-key'
      )
        return Response.json({
          paid: true,
          paidAt: '2026-01-01T00:00:00Z',
          plan: { interval: 'once' },
        });
      throw new Error('Unexpected provider request');
    };
  });
  const panel = await context.newPage();
  await panel.goto(
    `chrome-extension://${new URL(worker.url()).host}/sidepanel.html`,
  );
  await expect(
    panel.getByRole('button', { name: 'Buy lifetime · $2.99' }),
  ).toBeEnabled();
  const checkoutPromise = context.waitForEvent('page');
  await panel.getByRole('button', { name: 'Buy lifetime · $2.99' }).click();
  const checkout = await checkoutPromise;
  await expect
    .poll(() => checkout.url())
    .toContain('/choose-plan?api_key=fixture-key');
  await expect(panel.getByRole('heading', { name: 'Free plan' })).toBeVisible();
  await panel.getByRole('button', { name: 'Refresh license' }).click();
  await expect(
    panel.getByRole('heading', { name: 'Lifetime license active' }),
  ).toBeVisible();
  expect(
    await panel.evaluate(
      async () => (await chrome.storage.sync.get(null)).extensionpay_api_key,
    ),
  ).toBeUndefined();
  expect(
    await panel.evaluate(
      async () =>
        (await chrome.storage.local.get('extensionpay_api_key'))
          .extensionpay_api_key,
    ),
  ).toBe('fixture-key');
  const restorePromise = context.waitForEvent('page');
  await panel.getByRole('button', { name: 'Restore purchase' }).click();
  const restore = await restorePromise;
  await expect
    .poll(() => restore.url())
    .toContain('/reactivate?api_key=fixture-key');
  await panel.reload();
  await expect(
    panel.getByRole('heading', { name: 'Lifetime license active' }),
  ).toBeVisible();
});
