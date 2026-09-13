/* global chrome */
import process from 'node:process';
import console from 'node:console';
import { URL } from 'node:url';
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
  copyFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const output = resolve('artifacts/submission/assets');
await mkdir(output, { recursive: true });
const work = await mkdtemp(join(tmpdir(), 'page-monitor-store-assets-'));
let context;
try {
  const build = join(work, 'extension');
  execFileSync(
    process.execPath,
    [resolve('node_modules/vite/bin/vite.js'), 'build', '--outDir', build],
    {
      env: { ...process.env, VITE_EXTPAY_EXTENSION_ID: 'store-preview' },
      stdio: 'pipe',
    },
  );
  context = await chromium.launchPersistentContext(join(work, 'profile'), {
    channel: 'chromium',
    headless: true,
    viewport: { width: 620, height: 720 },
    args: [
      `--disable-extensions-except=${build}`,
      `--load-extension=${build}`,
      '--host-resolver-rules=MAP * ~NOTFOUND',
      '--disable-background-networking',
    ],
  });
  await context.route('https://**/*', (route) => route.abort());
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const panel = await context.newPage();
  await panel.goto(
    `chrome-extension://${new URL(worker.url()).host}/sidepanel.html`,
  );
  const now = Date.now();
  const monitor = (id, name, selector, text) => ({
    id,
    name,
    url: `https://example.com/${id}`,
    selector,
    intervalSeconds: 300,
    durationMinutes: null,
    endsAt: null,
    enabled: true,
    snapshot: text,
    lastCheckAt: now,
    lastChangeAt: null,
    error: null,
    source: 'background',
    history: [],
    unread: 0,
  });
  const monitors = [
    monitor(
      'builds',
      'Build dashboard / release',
      '#release',
      'Release: 1.8.4',
    ),
    monitor(
      'status',
      'Service status / queue',
      '#queue-depth',
      'Pending jobs: 12',
    ),
  ];
  monitors[0].history = [
    {
      id: 'demo-change',
      at: now,
      before: 'Release: 1.8.3',
      after: 'Release: 1.8.4',
      delivered: true,
    },
  ];
  monitors[0].unread = 1;
  monitors[0].lastChangeAt = now;
  await panel.evaluate(async (monitors) => {
    await chrome.storage.local.set({ pageMonitor: { version: 1, monitors } });
  }, monitors);
  await panel.reload();
  await panel
    .getByRole('article', { name: monitors[0].name, exact: true })
    .waitFor();
  await panel
    .getByRole('heading', { name: /^Monitors/ })
    .scrollIntoViewIfNeeded();
  const dashboard = await panel.screenshot();
  const card = panel.getByRole('article', {
    name: monitors[0].name,
    exact: true,
  });
  await card.getByText('Change history (1)', { exact: true }).click();
  await card.evaluate((node) => node.scrollIntoView({ block: 'start' }));
  const changes = await panel.screenshot();
  await panel.getByRole('button', { name: 'New monitor', exact: true }).click();
  await panel
    .getByLabel('Monitor name', { exact: true })
    .fill('Service status / queue');
  await panel
    .getByLabel('Page URL', { exact: true })
    .fill('https://example.com/status');
  await panel.getByLabel('CSS selector', { exact: true }).fill('#queue-depth');
  await panel
    .getByRole('heading', { name: 'New monitor', exact: true })
    .scrollIntoViewIfNeeded();
  const editor = await panel.screenshot();
  const icon = (await readFile('public/icons/128.png')).toString('base64');
  const canvas = await context.newPage();
  await canvas.setViewportSize({ width: 1280, height: 800 });
  const frame = async (screenshot, title, description, notes, filename) => {
    await canvas.setContent(`<!doctype html><html><head><style>
      *{box-sizing:border-box}body{margin:0;background:#f3f3f1;color:#222;font:16px Arial,sans-serif}
      header{height:56px;display:flex;align-items:center;justify-content:space-between;padding:0 28px;border-bottom:1px solid #bbb;background:#fff;font-size:16px}
      header span{font-size:12px;color:#666}main{display:grid;grid-template-columns:1fr 620px;gap:44px;padding:24px 28px;height:744px}
      .notes{padding:16px 0}h1{font-size:24px;font-weight:600;margin:0 0 14px;line-height:1.3}p{font-size:16px;line-height:1.6;margin:0 0 28px;max-width:450px}
      dl{margin:0;border-top:1px solid #b9b9b6;max-width:450px}dt{font-size:13px;color:#666;margin-top:20px}dd{font-size:15px;line-height:1.5;margin:5px 0 20px}code{font:14px ui-monospace,monospace}
      .footnote{margin-top:32px;font-size:12px;color:#666}.screen{width:620px;height:696px;overflow:hidden;border:1px solid #bbb;background:#fff}.screen img{display:block;width:620px;height:720px}
      </style></head><body><header><strong>Page Monitor</strong><span>Chrome extension · Example data</span></header><main><section class="notes"><h1>${title}</h1><p>${description}</p><dl>${notes}</dl><p class="footnote">Actual extension UI. All example URLs and values are synthetic.</p></section><div class="screen"><img src="data:image/png;base64,${screenshot.toString('base64')}"></div></main></body></html>`);
    await canvas.screenshot({ path: join(output, filename) });
  };
  await frame(
    dashboard,
    'Monitors',
    'Poll selected page text and retain a local change history.',
    '<dt>Selection</dt><dd>CSS selector or visual element picker</dd><dt>Checks</dt><dd>Read an existing tab, request background HTML, or render the page in a temporary tab.</dd><dt>Free limits</dt><dd>3 active monitors · 5-minute minimum interval</dd><dt>Lifetime license</dt><dd>$2.99 · 30-second minimum · 20 saved monitors</dd>',
    '01-monitor-changes.png',
  );
  await frame(
    editor,
    'Monitor configuration',
    'Set the URL, selector, polling interval and duration.',
    '<dt>Example selector</dt><dd><code>#queue-depth</code></dd><dt>Validation</dt><dd>Test that the selector matches one nonempty region before saving.</dd><dt>JavaScript rendering</dt><dd>Use a temporary tab when the selected content is absent from the initial HTML.</dd><dt>Session</dt><dd>Uses the available browser session. Authenticated pages require a valid login.</dd>',
    '02-create-monitor.png',
  );
  await frame(
    changes,
    'Text diff',
    'Compare the previous and current normalized text.',
    '<dt>Baseline</dt><dd>The first successful read sets the baseline. Failed reads preserve it.</dd><dt>Comparison</dt><dd>Whitespace is normalized. Added and removed text is highlighted.</dd><dt>Retention</dt><dd>Latest 10 changes per monitor, stored locally.</dd><dt>Notifications</dt><dd>Desktop alert and unread badge on a detected change.</dd>',
    '03-change-history.png',
  );
  await canvas.setViewportSize({ width: 440, height: 280 });
  await canvas.setContent(
    `<!doctype html><style>*{box-sizing:border-box}body{margin:0;background:#efefec;color:#222;font-family:Arial,sans-serif}main{height:280px;padding:26px 28px}header{display:flex;gap:12px;align-items:center;border-bottom:1px solid #aaa;padding-bottom:20px}img{width:32px;height:32px}h1{font-size:24px;font-weight:600;margin:0}p{font-size:16px;line-height:1.6;margin:24px 0}footer{font:13px ui-monospace,monospace;color:#555;border-top:1px solid #aaa;padding-top:16px}</style><main><header><img src="data:image/png;base64,${icon}"><h1>Page Monitor</h1></header><p>DOM text monitoring<br>CSS selectors · Local change history</p><footer>Browser extension / Chrome + Firefox</footer></main>`,
  );
  await canvas.screenshot({ path: join(output, 'promo-440x280.png') });
  await copyFile('public/icons/128.png', join(output, 'icon-128.png'));
  await writeFile(
    join(output, 'README.txt'),
    'Store assets use the real compiled Chrome UI in a disposable offline profile, with synthetic example.com data. The temporary store-preview product ID is never packaged for submission. Screenshots: 1280x800. Promo: 440x280. Icon: 128x128.\n',
  );
  console.log(`Store images: ${output}`);
} finally {
  await context?.close();
  await rm(work, { recursive: true, force: true });
}
