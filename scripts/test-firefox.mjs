/* global fetch, AbortSignal */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

// Stock Firefox + geckodriver. No production test hooks or extra npm dependencies.
// GECKODRIVER and FIREFOX_BINARY override executables; HEADLESS=0 shows the test UI.
const extension = resolve('dist-firefox');
const manifest = JSON.parse(
  await readFile(join(extension, 'manifest.json'), 'utf8'),
);
const id = manifest.browser_specific_settings.gecko.id;
const profileRoot = await mkdtemp(join(tmpdir(), 'page-monitor-firefox-'));
const logPath = resolve('test-results/firefox-geckodriver.log');
let driver;
let driverError;
let log = '';
let endpoint;
let session;
let price = '40';
let authenticated = true;
let requests = 0;
let assetRequests = 0;
const fixture = createServer((req, res) => {
  if (req.url === '/favicon.ico') {
    res.writeHead(204);
    res.end();
    return;
  }
  requests++;
  if (req.url === '/untrusted-asset') {
    assetRequests++;
    res.end('asset');
    return;
  }
  res.setHeader('cache-control', 'no-store');
  res.setHeader('content-type', 'text/html');
  if (req.url === '/login') {
    res.setHeader(
      'set-cookie',
      'session=fixture; HttpOnly; SameSite=Lax; Path=/',
    );
    res.end('<title>Fixture login</title>Signed in');
  } else if (
    !authenticated ||
    !req.headers.cookie?.includes('session=fixture')
  ) {
    res.writeHead(302, { location: '/login' });
    res.end();
  } else if (req.url === '/javascript') {
    res.end(
      `<!doctype html><title>JavaScript fixture</title><p>App shell</p><script>setTimeout(() => { const p=document.createElement('p'); p.id='price'; p.textContent=${JSON.stringify(price)}; document.body.append(p); }, 200);</script>`,
    );
  } else {
    res.end(
      `<!doctype html><title>Fixture dashboard</title><h1>Dashboard</h1><p id="price">${price}</p><img src="http://${req.headers.host}/untrusted-asset" alt=""><script src="http://${req.headers.host}/untrusted-asset"></script>`,
    );
  }
});
// All non-loopback HTTP(S) traffic is sent to a rejecting local proxy before startup.
const blocked = createServer((_req, res) => {
  res.writeHead(502);
  res.end();
});
blocked.on('connect', (_req, socket) => {
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
async function rpc(message) {
  const result = await rawRpc(message);
  assert.equal(result?.ok, true, JSON.stringify(result));
  return result.value;
}
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
  const base = `http://127.0.0.1:${await listen(fixture)}`;
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
    `
    const policy = WebExtensionPolicy.getByID(arguments[0]);
    const { ExtensionPermissions } = ChromeUtils.importESModule('resource://gre/modules/ExtensionPermissions.sys.mjs');
    await ExtensionPermissions.add(arguments[0], {permissions: [], origins: [arguments[1]]}, policy.extension);
    return policy.getURL('sidepanel.html');`,
    id,
    'http://127.0.0.1/*',
  );
  await navigate(`${base}/login`);
  await navigate(extensionUrl);
  assert.deepEqual((await rpc({ type: 'list' })).monitors, []);
  const create = async (url = `${base}/`, renderJavaScript = false) => {
    const view = await rpc({
      type: 'create',
      input: {
        name: 'Fixture price',
        url,
        selector: '#price',
        intervalSeconds: 86400,
        durationMinutes: null,
        renderJavaScript,
      },
    });
    const monitor = view.monitors.find((item) => item.url === url);
    await waitFor(async () => {
      const current = (await rpc({ type: 'list' })).monitors.find(
        (item) => item.id === monitor.id,
      );
      if (current?.error) throw new Error(JSON.stringify(current));
      return current?.snapshot;
    }, 'baseline');
    return monitor.id;
  };
  const monitorId = await create();
  let monitor = (await rpc({ type: 'list' })).monitors[0];
  assert.equal(monitor.snapshot, '40');
  assert.equal(monitor.source, 'background');
  assert.equal(monitor.history.length, 0);
  assert.equal(
    assetRequests,
    0,
    'Inert background parsing must not request images or scripts',
  );
  price = '39';
  monitor = (await rpc({ type: 'check', id: monitorId })).monitors[0];
  assert.equal(monitor.snapshot, '39');
  assert.equal(monitor.history.length, 1);
  assert.equal(
    await asyncScript('return await browser.action.getBadgeText({});'),
    '1',
  );
  authenticated = false;
  monitor = (await rpc({ type: 'check', id: monitorId })).monitors[0];
  assert.equal(monitor.snapshot, '39');
  assert.match(monitor.error, /redirect/i);
  authenticated = true;
  process.stdout.write(
    'PASS authenticated closed-tab fetch, changes, badge, expired session\n',
  );

  const panelHandle = await command('/window', undefined, 'GET');
  const pageHandle = (await command('/window/new', { type: 'tab' })).handle;
  await command('/window', { handle: pageHandle });
  await navigate(`${base}/`);
  await execute("document.querySelector('#price').textContent='37';");
  await command('/window', { handle: panelHandle });
  const before = requests;
  monitor = (await rpc({ type: 'check', id: monitorId })).monitors[0];
  assert.equal(monitor.snapshot, '37');
  assert.equal(monitor.source, 'tab');
  assert.equal(requests, before);
  const tabId = await asyncScript(
    'return (await browser.tabs.query({})).find(tab => tab.url === arguments[0]).id;',
    `${base}/`,
  );
  const beforeUnauthorized = (await rpc({ type: 'list' })).monitors;
  const unauthorized = await asyncScript(
    `return await browser.scripting.executeScript({ target: {tabId: arguments[0]}, func: async (id) => browser.runtime.sendMessage({type: 'delete', id}), args: [arguments[1]] });`,
    tabId,
    monitorId,
  );
  assert.equal(unauthorized[0].result.ok, false);
  assert.deepEqual((await rpc({ type: 'list' })).monitors, beforeUnauthorized);
  await rpc({ type: 'pick', tabId, url: `${base}/` });
  await rpc({ type: 'pick', tabId, url: `${base}/` });
  await command('/window', { handle: pageHandle });
  const element = await command('/element', {
    using: 'css selector',
    value: '#price',
  });
  await command(
    `/element/${element['element-6066-11e4-a52e-4f735466cecf']}/click`,
    {},
  );
  await command('/window', { handle: panelHandle });
  await waitFor(
    async () =>
      execute(
        "return document.querySelector('[aria-label=\"CSS selector\"]')?.value === '#price';",
      ),
    'picker selection',
  );
  await command('/window', { handle: pageHandle });
  await command('/window', undefined, 'DELETE');
  await command('/window', { handle: panelHandle });
  process.stdout.write(
    'PASS live tab extraction, repeated picker injection, selection\n',
  );

  const renderedId = await create(`${base}/javascript`, true);
  monitor = (await rpc({ type: 'list' })).monitors.find(
    (item) => item.id === renderedId,
  );
  assert.equal(monitor.snapshot, '39');
  assert.equal(monitor.source, 'rendered');
  assert.equal(
    (
      await asyncScript(
        'return (await browser.tabs.query({})).filter(tab => tab.url === arguments[0]);',
        `${base}/javascript`,
      )
    ).length,
    0,
  );
  process.stdout.write('PASS JavaScript rendering and temporary-tab cleanup\n');

  const saved = (await rpc({ type: 'list' })).monitors;
  assert.equal(
    (await rawRpc({ type: 'create', input: { url: 'file:///tmp/no' } })).ok,
    false,
  );
  assert.equal((await rawRpc({ type: 'unknown-operation' })).ok, false);
  assert.deepEqual((await rpc({ type: 'list' })).monitors, saved);
  await asyncScript(
    'return await browser.permissions.remove({origins: [arguments[0]]});',
    'http://127.0.0.1/*',
  );
  const count = requests;
  monitor = (await rpc({ type: 'check', id: monitorId })).monitors.find(
    (item) => item.id === monitorId,
  );
  assert.equal(monitor.snapshot, '37');
  assert.match(monitor.error, /permission|access/i);
  assert.equal(requests, count);
  process.stdout.write(
    'PASS malformed messages and permission revocation cause no unauthorized effects\n',
  );

  await navigate('about:blank');
  await chromeScript(
    `const { AddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs'); const addon = await AddonManager.getAddonByID(arguments[0]); await addon.reload();`,
    id,
  );
  await navigate(extensionUrl);
  assert.equal((await rpc({ type: 'list' })).monitors.length, 2);
  assert.equal(
    (await rpc({ type: 'list' })).monitors.find((item) => item.id === monitorId)
      .snapshot,
    '37',
  );
  process.stdout.write(
    'PASS extension reload preserves monitors and snapshots\n',
  );

  await chromeScript(
    `const policy=WebExtensionPolicy.getByID(arguments[0]); const { ExtensionPermissions }=ChromeUtils.importESModule('resource://gre/modules/ExtensionPermissions.sys.mjs'); await ExtensionPermissions.add(arguments[0], {permissions:[],origins:['http://127.0.0.1/*']}, policy.extension);`,
    id,
  );
  price = '42';
  await asyncScript(
    "await browser.alarms.create('monitor:'+arguments[0], {when:Date.now()+2000});",
    monitorId,
  );
  await navigate('about:blank');
  assert.equal(
    await chromeScript(
      `const extension=WebExtensionPolicy.getByID(arguments[0]).extension; await extension.terminateBackground({disableResetIdleForTest:true}); return extension.backgroundState;`,
      id,
    ),
    'stopped',
  );
  const beforeAlarm = requests;
  await waitFor(() => requests > beforeAlarm, 'alarm wakes stopped background');
  await navigate(extensionUrl);
  await waitFor(
    async () =>
      (await rpc({ type: 'list' })).monitors.find(
        (item) => item.id === monitorId,
      )?.snapshot === '42',
    'scheduled check persisted after wake',
  );
  process.stdout.write(
    'PASS alarm wakes stopped background and persists changed snapshot\n',
  );

  await navigate(`${base}/`);
  await chromeScript(
    `CustomizableUI.addWidgetToArea('page-monitor_local-browser-action', CustomizableUI.AREA_NAVBAR);`,
  );
  await command('/moz/context', { context: 'chrome' });
  const action = await command('/element', {
    using: 'css selector',
    value: '#page-monitor_local-browser-action',
  });
  await command(
    `/element/${action['element-6066-11e4-a52e-4f735466cecf']}/click`,
    {},
  );
  await waitFor(
    async () =>
      (await execute(`return SidebarController.currentID;`)) ===
      'page-monitor_local-sidebar-action',
    'native sidebar open',
  );
  await command('/moz/context', { context: 'content' });
  process.stdout.write(
    'PASS actual toolbar action opens native Firefox sidebar\n',
  );
} finally {
  if (session) await command('', undefined, 'DELETE').catch(() => {});
  driver?.kill('SIGTERM');
  fixture.closeAllConnections();
  blocked.closeAllConnections();
  await Promise.all([
    new Promise((done) => fixture.close(done)),
    new Promise((done) => blocked.close(done)),
  ]);
  const { mkdir } = await import('node:fs/promises');
  await mkdir(resolve('test-results'), { recursive: true });
  await writeFile(logPath, log);
  await rm(profileRoot, { recursive: true, force: true });
}
