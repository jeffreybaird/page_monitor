/* global fetch, AbortSignal */
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

// Stock Firefox + geckodriver. No production test hooks or extra npm dependencies.
// GECKODRIVER and FIREFOX_BINARY override executables; HEADLESS=0 shows the test UI.
const buildRoot = await mkdtemp(join(tmpdir(), 'page-monitor-consent-build-'));
const extension = join(buildRoot, 'extension');
execFileSync(
  process.execPath,
  [
    'node_modules/vite/bin/vite.js',
    'build',
    '--mode',
    'firefox',
    '--outDir',
    extension,
  ],
  {
    env: {
      ...process.env,
      VITE_EXTPAY_EXTENSION_ID: 'page-monitor-consent-fixture',
    },
    stdio: 'inherit',
  },
);
const manifest = JSON.parse(
  await readFile(join(extension, 'manifest.json'), 'utf8'),
);
const id = manifest.browser_specific_settings.gecko.id;
const profileRoot = await mkdtemp(join(tmpdir(), 'page-monitor-firefox-'));
const logPath = resolve('test-results/firefox-consent-geckodriver.log');
let driver;
let driverError;
let log = '';
let endpoint;
let session;
const providerRequests = [];
// All non-loopback HTTP(S) traffic is sent to a rejecting local proxy before startup.
const blocked = createServer((req, res) => {
  if (/extensionpay|stripe/i.test(req.url)) providerRequests.push(req.url);
  res.writeHead(502);
  res.end();
});
blocked.on('connect', (req, socket) => {
  if (/extensionpay|stripe/i.test(req.url)) providerRequests.push(req.url);
  socket.end('HTTP/1.1 502 Blocked\r\n\r\n');
});
async function listen(server) {
  await new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', done);
  });
  return server.address().port;
}
async function waitFor(work, description, timeout = 20000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const value = await work();
    if (value) return value;
    await delay(100);
  }
  throw new Error(`Timed out: ${description}`);
}
async function request(path, body, method = 'POST') {
  const response = await fetch(`${endpoint}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(60000),
  });
  const result = await response.json();
  if (!response.ok || result.value?.error)
    throw new Error(JSON.stringify(result.value));
  return result.value;
}
const command = (path, body, method) =>
  request(`/session/${session}${path}`, body, method);
const execute = (script, ...args) => command('/execute/sync', { script, args });
async function asyncScript(script, ...args) {
  const result = await command('/execute/async', {
    script: `const done=arguments[arguments.length-1]; (async()=>{${script}})().then(value=>done({value}),error=>done({failure:String(error)}));`,
    args,
  });
  if (result.failure) throw new Error(result.failure);
  return result.value;
}
const rawRpc = (message) =>
  asyncScript(
    'return await browser.runtime.sendMessage(arguments[0]);',
    message,
  );
const navigate = (url) => command('/url', { url });
async function chromeScript(script, ...args) {
  await command('/moz/context', { context: 'chrome' });
  try {
    return await asyncScript(script, ...args);
  } finally {
    await command('/moz/context', { context: 'content' });
  }
}
try {
  const proxyPort = await listen(blocked);
  driver = spawn(
    process.env.GECKODRIVER || 'geckodriver',
    [
      '--port',
      '0',
      '--host',
      '127.0.0.1',
      '--allow-system-access',
      '--profile-root',
      profileRoot,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  driver.on('error', (error) => {
    driverError = error;
  });
  for (const stream of [driver.stdout, driver.stderr])
    stream.on('data', (chunk) => {
      log += chunk.toString();
      const match = log.match(/Listening on (127\.0\.0\.1:\d+)/);
      if (match) endpoint = `http://${match[1]}`;
    });
  await waitFor(() => {
    if (driverError) throw driverError;
    return endpoint;
  }, 'geckodriver startup');
  const options = {
    args: process.env.HEADLESS === '0' ? [] : ['-headless'],
    prefs: {
      'network.proxy.type': 1,
      'network.proxy.failover_direct': false,
      'network.proxy.http': '127.0.0.1',
      'network.proxy.http_port': proxyPort,
      'network.proxy.ssl': '127.0.0.1',
      'network.proxy.ssl_port': proxyPort,
      'network.proxy.no_proxies_on': '127.0.0.1,localhost',
      'network.trr.mode': 5,
      'network.dns.disablePrefetch': true,
      'network.prefetch-next': false,
      'network.http.speculative-parallel-limit': 0,
      'extensions.update.enabled': false,
    },
  };
  if (process.env.FIREFOX_BINARY) options.binary = process.env.FIREFOX_BINARY;
  const started = await request('/session', {
    capabilities: {
      alwaysMatch: { browserName: 'firefox', 'moz:firefoxOptions': options },
    },
  });
  session = started.sessionId;
  process.stdout.write(`Firefox ${started.capabilities.browserVersion}\n`);
  await command('/timeouts', { script: 45000, pageLoad: 30000, implicit: 0 });
  assert.equal(
    await command('/moz/addon/install', { path: extension, temporary: true }),
    id,
  );
  const extensionUrl = await chromeScript(
    "return WebExtensionPolicy.getByID(arguments[0]).getURL('sidepanel.html');",
    id,
  );
  await navigate(extensionUrl);
  const panelHandle = await command('/window', undefined, 'GET');
  const grants = () =>
    asyncScript('return await browser.permissions.getAll();');
  const status = () =>
    execute(
      "return document.querySelector('[aria-label=License] .status').textContent;",
    );
  const click = async (using, value) => {
    if (value.startsWith('#addon-webext')) {
      await waitFor(
        () =>
          execute(
            "const b=document.querySelector(arguments[0]); return document.getElementById('notification-popup')?.state === 'open' && b?.getBoundingClientRect().width > 0;",
            value,
          ),
        'native button layout',
      );
      // Marionette element-click misidentifies native popup controls as offscreen.
      // Pointer actions activate the real control using its observed position.
      const point = await execute(
        'const r=document.querySelector(arguments[0]).getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};',
        value,
      );
      await command('/actions', {
        actions: [
          {
            type: 'pointer',
            id: 'native-mouse',
            parameters: { pointerType: 'mouse' },
            actions: [
              {
                type: 'pointerMove',
                duration: 0,
                origin: 'viewport',
                ...point,
              },
              { type: 'pointerDown', button: 0 },
              { type: 'pointerUp', button: 0 },
            ],
          },
        ],
      });
      return;
    }
    const element = await command('/element', { using, value });
    await command(
      `/element/${element['element-6066-11e4-a52e-4f735466cecf']}/click`,
      {},
    );
  };
  const requestConsent = async (label) => {
    await waitFor(
      () =>
        execute(
          "const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent===arguments[0]);return !!b && !b.disabled;",
          label,
        ),
      'purchase controls ready',
    );
    await click('xpath', `//button[text()='${label}']`);
    await command('/moz/context', { context: 'chrome' });
    await waitFor(
      () =>
        execute(
          "return document.getElementById('addon-webext-permissions-notification')?.getBoundingClientRect().height > 0;",
        ),
      'native permissions notification',
    );
  };
  assert.deepEqual((await grants()).data_collection, []);
  await requestConsent('Buy lifetime · $2.99');
  await click(
    'css selector',
    '#addon-webext-permissions-notification .popup-notification-secondary-button',
  );
  await command('/moz/context', { context: 'content' });
  await waitFor(
    async () => /denied/i.test(await status()),
    'denial shown in UI',
  );
  assert.deepEqual((await grants()).data_collection, []);
  assert.equal(providerRequests.length, 0);
  assert.equal((await command('/window/handles', undefined, 'GET')).length, 1);
  process.stdout.write(
    'PASS native deny leaves no data grants, provider request, or checkout window\n',
  );
  await requestConsent('Restore purchase');
  await click(
    'css selector',
    '#addon-webext-permissions-notification .popup-notification-primary-button',
  );
  await command('/moz/context', { context: 'content' });
  await command('/window', { handle: panelHandle });
  const expected = [
    'authenticationInfo',
    'personallyIdentifyingInfo',
    'financialAndPaymentInfo',
  ];
  await waitFor(async () => {
    const current = await grants();
    return expected.every((name) => current.data_collection.includes(name));
  }, 'native consent grants');
  process.stdout.write('PASS native allow grants all three data categories\n');
  await waitFor(
    () => providerRequests.length > 0,
    'proxy observes and blocks provider contact after consent',
  );
  await asyncScript(
    'return await browser.permissions.remove({data_collection: arguments[0]});',
    expected,
  );
  assert.deepEqual((await grants()).data_collection, []);
  // Wait for the allowed restore attempt to settle before measuring revocation.
  await waitFor(
    async () =>
      !(await execute(
        "return document.querySelector('[aria-label=License]').getAttribute('aria-busy') === 'true';",
      )),
    'restore attempt settles',
  );
  const before = providerRequests.length;
  for (const type of ['purchase', 'restore-purchase', 'refresh-license']) {
    const reply = await rawRpc({ type });
    assert.equal(reply.ok, false);
    assert.match(reply.error, /Allow licensing data access/);
  }
  assert.equal(providerRequests.length, before);
  assert.equal((await rawRpc({ type: 'list' })).value.license.paid, false);
  process.stdout.write(
    'PASS real permission revocation rejects purchase, restore, refresh before provider contact\n',
  );
} finally {
  if (session) await command('', undefined, 'DELETE').catch(() => {});
  driver?.kill('SIGTERM');
  blocked.closeAllConnections();
  await Promise.all([new Promise((done) => blocked.close(done))]);
  const { mkdir } = await import('node:fs/promises');
  await mkdir(resolve('test-results'), { recursive: true });
  await writeFile(logPath, log);
  await rm(profileRoot, { recursive: true, force: true });
  await rm(buildRoot, { recursive: true, force: true });
}
