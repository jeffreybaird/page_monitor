import {
  test,
  expect,
  chromium,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Reply, Request, View } from '../../src/shared/model';
let server: Server;
let context: BrowserContext;
let panel: Page;
let base: string;
let profile: string;
let price = '40';
let sessionRequired = false;
let requests = 0;
let loggedIn = true;
async function rpc(request: Request): Promise<View> {
  const reply: Reply = await panel.evaluate(
    async (request) => chrome.runtime.sendMessage(request),
    request,
  );
  if (!reply.ok) throw new Error(reply.error);
  return reply.value;
}
test.beforeEach(async () => {
  price = '40';
  sessionRequired = false;
  requests = 0;
  loggedIn = true;
  server = createServer((req, res) => {
    requests++;
    if (
      sessionRequired &&
      (!loggedIn || !req.headers.cookie?.includes('session=fixture'))
    ) {
      res.writeHead(302, { location: '/login' });
      res.end();
      return;
    }
    res.writeHead(200, {
      'content-type': 'text/html',
      'cache-control': 'no-store',
    });
    res.end(
      `<!doctype html><html lang="en"><head><title>Fixture dashboard</title></head><body><h1>Fixture dashboard</h1><section aria-label="Last 15 minutes"><p id="price">${price}</p></section><button onclick="document.getElementById('price').textContent='39'">Change live price</button><a href="/different">Navigate away</a></body></html>`,
    );
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('No fixture port');
  base = `http://127.0.0.1:${address.port}`;
  profile = await mkdtemp(join(tmpdir(), 'page-monitor-test-'));
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${resolve('dist')}`,
      `--load-extension=${resolve('dist')}`,
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
      '--disable-background-networking',
    ],
  });
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(base) || url.startsWith('chrome-extension:'))
      await route.continue();
    else await route.abort();
  });
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  panel = await context.newPage();
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  // Seed only the local fixture origin through Chromium's extension settings.
  // Native permission prompt acceptance remains a manual UI check.
  const settings = await context.newPage();
  await settings.goto('chrome://extensions');
  await settings.evaluate(
    async ({ id, origin }) => {
      const api = (
        chrome as unknown as {
          developerPrivate: {
            addHostPermission: (id: string, host: string) => Promise<void>;
          };
        }
      ).developerPrivate;
      await api.addHostPermission(id, origin);
    },
    { id, origin: `${base}/*` },
  );
  await settings.close();
  expect(
    await panel.evaluate(
      async (origin) => chrome.permissions.request({ origins: [origin] }),
      `${base}/*`,
    ),
  ).toBe(true);
});
test.afterEach(async () => {
  await context?.close();
  await new Promise<void>((done) => server?.close(() => done()));
  if (profile) await rm(profile, { recursive: true, force: true });
});
async function create() {
  const v = await rpc({
    type: 'create',
    input: {
      name: 'Fixture price',
      url: `${base}/`,
      selector: '#price',
      intervalSeconds: 30,
      durationMinutes: null,
    },
  });
  return v.monitors[0].id;
}
async function waitForBaseline() {
  await expect
    .poll(async () => (await rpc({ type: 'list' })).monitors[0]?.snapshot)
    .toBe('40');
}
test('background checks use session cookies, detect subsequent changes, and preserve baseline on logout', async () => {
  sessionRequired = true;
  await context.addCookies([
    {
      name: 'session',
      value: 'fixture',
      url: base,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  const id = await create();
  await waitForBaseline();
  expect((await rpc({ type: 'list' })).monitors[0].history).toHaveLength(0);
  price = '39';
  let state = await rpc({ type: 'check', id });
  expect(state.monitors[0].snapshot).toBe('39');
  expect(state.monitors[0].history).toHaveLength(1);
  expect(state.monitors[0].source).toBe('background');
  price = '38';
  state = await rpc({ type: 'check', id });
  expect(state.monitors[0].history).toHaveLength(2);
  state = await rpc({ type: 'check', id });
  expect(state.monitors[0].history).toHaveLength(2);
  loggedIn = false;
  state = await rpc({ type: 'check', id });
  expect(state.monitors[0].snapshot).toBe('38');
  expect(state.monitors[0].error).toContain('redirected');
  expect(state.monitors[0].history).toHaveLength(2);
  expect(await panel.evaluate(() => chrome.action.getBadgeText({}))).toBe('2');
  await rpc({ type: 'read', id });
  expect(await panel.evaluate(() => chrome.action.getBadgeText({}))).toBe('');
  await rpc({ type: 'delete', id });
  expect((await rpc({ type: 'list' })).monitors).toHaveLength(0);
});
test('reads an existing tab without reload, then switches to background after closure', async () => {
  const page = await context.newPage();
  await page.goto(`${base}/`);
  const id = await create();
  await waitForBaseline();
  const count = requests;
  await page.getByRole('button', { name: 'Change live price' }).click();
  let state = await rpc({ type: 'check', id });
  expect(state.monitors[0].snapshot).toBe('39');
  expect(state.monitors[0].source).toBe('tab');
  expect(requests).toBe(count);
  await page.close();
  price = '38';
  state = await rpc({ type: 'check', id });
  expect(state.monitors[0].snapshot).toBe('38');
  expect(state.monitors[0].source).toBe('background');
});
test('rejects unauthorized messages and handles real permission revocation', async () => {
  const page = await context.newPage();
  await page.goto(`${base}/`);
  const id = await create();
  await waitForBaseline();
  const tabId = await panel.evaluate(
    async (url) => (await chrome.tabs.query({ url }))[0]?.id,
    `${base}/`,
  );
  expect(tabId).toBeDefined();
  const result = await panel.evaluate(
    async (tabId) =>
      chrome.scripting.executeScript({
        target: { tabId: tabId as number },
        func: async () =>
          chrome.runtime.sendMessage({ type: 'delete', id: 'forged' }),
      }),
    tabId,
  );
  expect(result[0].result).toEqual({
    ok: false,
    error: 'Unauthorized or invalid request.',
  });
  expect((await rpc({ type: 'list' })).monitors).toHaveLength(1);
  await panel.evaluate(
    async (origin) => chrome.permissions.remove({ origins: [origin] }),
    `${base}/*`,
  );
  const before = requests;
  const state = await rpc({ type: 'check', id });
  expect(state.monitors[0].error).toContain('access');
  expect(requests).toBe(before);
  expect(state.monitors[0].snapshot).toBe('40');
});
test('picker is repeatable, cancellable, and creates a monitor through the panel UI', async () => {
  const page = await context.newPage();
  await page.goto(`${base}/`);
  const tabId = await panel.evaluate(
    async (url) => (await chrome.tabs.query({ url }))[0]?.id,
    `${base}/`,
  );
  if (tabId === undefined) throw new Error('No fixture tab');
  await rpc({ type: 'pick', tabId, url: `${base}/` });
  await rpc({ type: 'pick', tabId, url: `${base}/` });
  await expect(page.locator('[data-page-monitor-overlay]')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-page-monitor-overlay]')).toHaveCount(0);
  await rpc({ type: 'pick', tabId, url: `${base}/` });
  await page.locator('#price').hover();
  await page.locator('#price').click();
  await expect(panel.getByLabel('CSS selector', { exact: true })).toHaveValue(
    '#price',
  );
  await expect(page.locator('[data-page-monitor-overlay]')).toHaveCount(0);
  await panel.getByLabel('Monitor name', { exact: true }).fill('My dashboard');
  await panel.getByLabel('Check every', { exact: true }).fill('2');
  await panel
    .getByLabel('Monitor for', { exact: true })
    .selectOption('duration');
  await panel.getByLabel('Run for (minutes)', { exact: true }).fill('60');
  await panel
    .getByRole('button', { name: 'Start monitoring', exact: true })
    .click();
  await expect(
    panel.getByRole('article', { name: 'My dashboard' }),
  ).toBeVisible();
  await waitForBaseline();
  const m = (await rpc({ type: 'list' })).monitors[0];
  expect(m.intervalSeconds).toBe(120);
  expect(m.durationMinutes).toBe(60);
  await panel.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(
    panel.getByRole('button', { name: 'Resume', exact: true }),
  ).toBeVisible();
  await panel.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(panel.getByLabel('Monitor name', { exact: true })).toHaveValue(
    'My dashboard',
  );
  await panel.getByRole('button', { name: 'Cancel edit', exact: true }).click();
  // Selecting the same unchanged region after saving must repopulate the reset form.
  await rpc({ type: 'pick', tabId, url: `${base}/` });
  await page.locator('#price').hover();
  await page.locator('#price').click();
  await expect(panel.getByLabel('CSS selector', { exact: true })).toHaveValue(
    '#price',
  );
  await panel.setViewportSize({ width: 360, height: 1000 });
  await panel.screenshot({
    path: 'test-results/sidepanel.png',
    fullPage: true,
  });
  expect(
    await panel.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await panel.getByRole('button', { name: 'Delete', exact: true }).click();
  await panel
    .getByRole('button', { name: 'Keep monitor', exact: true })
    .click();
  expect((await rpc({ type: 'list' })).monitors).toHaveLength(1);
});
test('recovers missing alarms and pending alerts after real worker termination', async () => {
  const id = await create();
  await waitForBaseline();
  const cdp = await context.newCDPSession(panel);
  let versions: {
    versionId: string;
    scriptURL: string;
    runningStatus: string;
  }[] = [];
  cdp.on('ServiceWorker.workerVersionUpdated', (event) => {
    versions = event.versions;
  });
  await cdp.send('ServiceWorker.enable');
  await expect
    .poll(() =>
      versions.some(
        (v) =>
          v.scriptURL.endsWith('/background.js') &&
          v.runningStatus === 'running',
      ),
    )
    .toBe(true);
  const version = versions.find(
    (v) =>
      v.scriptURL.endsWith('/background.js') && v.runningStatus === 'running',
  );
  if (!version) throw new Error('Worker not found');
  await panel.evaluate(async (id) => {
    const stored = await chrome.storage.local.get('pageMonitor');
    const state = stored.pageMonitor as {
      monitors: import('../../src/shared/model').Monitor[];
    };
    const m = state.monitors.find((m) => m.id === id);
    if (!m) throw new Error('Monitor not found');
    m.history = [
      {
        id: 'recovered',
        at: Date.now(),
        before: '39',
        after: '40',
        delivered: false,
      },
    ];
    m.unread = 1;
    await chrome.storage.local.set({ pageMonitor: state });
    await chrome.alarms.clearAll();
  }, id);
  await cdp.send('ServiceWorker.stopWorker', { versionId: version.versionId });
  await rpc({ type: 'list' });
  await expect
    .poll(
      async () =>
        await panel.evaluate(async () =>
          (await chrome.alarms.getAll()).map((a) => a.name),
        ),
    )
    .toContain(`monitor:${id}`);
  const state = await rpc({ type: 'list' });
  expect(state.monitors[0].history).toHaveLength(1);
  expect(state.monitors[0].snapshot).toBe('40');
  // Chrome accepted desktop delivery even though headless OS presentation is not asserted.
  expect(state.monitors[0].history[0].delivered).toBe(true);
  await cdp.detach();
});

test('opens the actual side panel context and retains the selected save target', async () => {
  const windowId = await panel.evaluate(
    async () => (await chrome.windows.getCurrent()).id,
  );
  if (windowId === undefined) throw new Error('No window');
  await panel.evaluate(
    (windowId) => chrome.sidePanel.open({ windowId }),
    windowId,
  );
  await expect
    .poll(async () =>
      panel.evaluate(
        async () =>
          (
            await chrome.runtime.getContexts({
              contextTypes: [chrome.runtime.ContextType.SIDE_PANEL],
            })
          ).length,
      ),
    )
    .toBe(1);
  expect(
    await panel.evaluate(() => chrome.sidePanel.getPanelBehavior()),
  ).toEqual({ openPanelOnActionClick: true });
  const first = await create();
  await waitForBaseline();
  await rpc({
    type: 'create',
    input: {
      name: 'Second region',
      url: `${base}/`,
      selector: 'h1',
      intervalSeconds: 300,
      durationMinutes: null,
    },
  });
  await panel
    .getByRole('article', { name: 'Fixture price', exact: true })
    .getByRole('button', { name: 'Edit', exact: true })
    .click();
  await panel.getByLabel('Monitor name', { exact: true }).fill('Renamed first');
  // Hold just the permission response to reproduce interaction during an in-flight save.
  await panel.evaluate(() => {
    const fixture = window as unknown as { releasePermission?: () => void };
    chrome.permissions.request = () =>
      new Promise<boolean>((resolve) => {
        fixture.releasePermission = () => resolve(true);
      });
  });
  await panel
    .getByRole('button', { name: 'Save changes', exact: true })
    .click();
  await panel
    .getByRole('article', { name: 'Second region', exact: true })
    .getByRole('button', { name: 'Edit', exact: true })
    .click();
  await panel.evaluate(() =>
    (
      window as unknown as { releasePermission: () => void }
    ).releasePermission(),
  );
  await expect(
    panel.getByRole('article', { name: 'Renamed first', exact: true }),
  ).toBeVisible();
  const state = await rpc({ type: 'list' });
  expect(state.monitors.find((m) => m.id === first)?.name).toBe(
    'Renamed first',
  );
  expect(state.monitors.find((m) => m.id !== first)?.name).toBe(
    'Second region',
  );
});

test('tests selector text before saving without creating a monitor or notification', async () => {
  const page = await context.newPage();
  await page.goto(`${base}/`);
  await panel.getByLabel('Page URL', { exact: true }).fill(`${base}/`);
  const field = panel.getByLabel('CSS selector', { exact: true });
  const testButton = panel.getByRole('button', {
    name: 'Test selector',
    exact: true,
  });
  await field.fill('[');
  await testButton.click();
  await expect(
    panel.getByText('Invalid CSS selector. Correct its syntax and try again.', {
      exact: true,
    }),
  ).toBeVisible();
  await field.fill('#missing');
  await testButton.click();
  await expect(panel.getByText(/Selected region was not found/)).toBeVisible();
  await field.fill('body *');
  await testButton.click();
  await expect(
    panel.getByText('Selection is ambiguous. Reselect the region.', {
      exact: true,
    }),
  ).toBeVisible();
  await field.fill('#price');
  await testButton.click();
  await expect(
    panel.getByText(
      'Valid selector · One region found in the open tab. Nothing has been saved.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(panel.locator('.preview')).toHaveText('40');
  expect((await rpc({ type: 'list' })).monitors).toHaveLength(0);
  expect(await panel.evaluate(() => chrome.action.getBadgeText({}))).toBe('');
  await field.fill('h1');
  await expect(
    panel.getByText('Selector not tested for these settings.', { exact: true }),
  ).toBeVisible();
  await expect(panel.locator('.preview')).not.toHaveText('40');
  await page.close();
  await field.fill('#price');
  await testButton.click();
  await expect(
    panel.getByText(
      'Valid selector · One region found in background HTML. Nothing has been saved.',
      { exact: true },
    ),
  ).toBeVisible();
  await panel.evaluate(
    async (origin) => chrome.permissions.remove({ origins: [origin] }),
    `${base}/*`,
  );
  const reply: Reply = await panel.evaluate(
    async (url) =>
      chrome.runtime.sendMessage({
        type: 'test-selector',
        url,
        selector: '#price',
      }),
    `${base}/`,
  );
  expect(reply.ok).toBe(false);
  expect((await rpc({ type: 'list' })).monitors).toHaveLength(0);
});
