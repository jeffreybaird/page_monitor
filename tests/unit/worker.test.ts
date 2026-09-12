import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Monitor, Reply } from '../../src/shared/model';
const mocks = vi.hoisted(() => ({
  readRegion: vi.fn(),
  deliver: vi.fn(),
  updateBadge: vi.fn(),
  notifyRendering: vi.fn(),
}));
vi.mock('../../src/background/reader', () => ({
  readRegion: mocks.readRegion,
}));
vi.mock('../../src/background/notifiers', () => ({
  deliver: mocks.deliver,
  updateBadge: mocks.updateBadge,
  notifyRendering: mocks.notifyRendering,
}));
vi.mock('../../src/background/renderer', () => ({
  cleanupRenderingTabs: vi.fn().mockResolvedValue(undefined),
  releaseRenderingTab: vi.fn().mockResolvedValue(undefined),
  RENDER_CLEANUP_ALARM: 'render-cleanup',
}));
const base = (): Monitor => ({
  id: 'monitor1',
  name: 'Price',
  url: 'https://example.com/',
  selector: '#price',
  intervalSeconds: 30,
  durationMinutes: null,
  endsAt: null,
  enabled: true,
  snapshot: '40',
  lastCheckAt: 1,
  lastChangeAt: null,
  error: null,
  source: 'tab',
  history: [],
  unread: 0,
});
let data: Record<string, unknown>;
let onMessage: (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  respond: (reply: Reply) => void,
) => unknown;
let onAlarm: (alarm: { name: string }) => void;
let set: ReturnType<typeof vi.fn>;
let alarms: Map<string, unknown>;
const extensionId = 'test-extension';
const sender = {
  id: extensionId,
  url: `chrome-extension://${extensionId}/sidepanel.html`,
  frameId: 0,
};
function rpc(
  message: unknown,
  context: chrome.runtime.MessageSender = sender,
): Promise<Reply> {
  return new Promise((resolve) => onMessage(message, context, resolve));
}
beforeEach(async () => {
  vi.resetModules();
  mocks.readRegion.mockReset().mockResolvedValue({ text: '41', source: 'tab' });
  mocks.deliver.mockReset().mockResolvedValue(undefined);
  mocks.notifyRendering.mockReset().mockResolvedValue(undefined);
  mocks.updateBadge.mockReset().mockResolvedValue(undefined);
  data = { pageMonitor: { version: 1, monitors: [base()] } };
  alarms = new Map();
  set = vi.fn(async (values: Record<string, unknown>) => {
    Object.assign(data, structuredClone(values));
  });
  const local = {
    get: async (key: string) => ({ [key]: structuredClone(data[key]) }),
    set,
    setAccessLevel: async () => {},
  };
  vi.stubGlobal('chrome', {
    tabs: { onActivated: { addListener: vi.fn() } },
    runtime: {
      id: extensionId,
      getURL: (p: string) => `chrome-extension://${extensionId}/${p}`,
      onMessage: {
        addListener: (fn: typeof onMessage) => {
          onMessage = fn;
        },
      },
      onInstalled: { addListener: vi.fn() },
      onStartup: { addListener: vi.fn() },
    },
    storage: {
      local,
      session: {
        get: vi.fn(async () => ({})),
        set: vi.fn(),
        remove: vi.fn(),
        setAccessLevel: async () => {},
      },
    },
    alarms: {
      get: async (name: string) => alarms.get(name),
      getAll: async () => Array.from(alarms.keys()).map((name) => ({ name })),
      create: async (name: string, value: unknown) => {
        alarms.set(name, value);
      },
      clear: async (name: string) => alarms.delete(name),
      onAlarm: {
        addListener: (fn: typeof onAlarm) => {
          onAlarm = fn;
        },
      },
    },
    permissions: {
      contains: async () => true,
      onRemoved: { addListener: vi.fn() },
    },
    sidePanel: { setPanelBehavior: async () => {} },
    notifications: { onClicked: { addListener: vi.fn() } },
  });
  await import('../../src/background/index');
  await rpc({ type: 'list' });
});
function current(): Monitor {
  return (data.pageMonitor as { monitors: Monitor[] }).monitors[0];
}
describe('worker ownership and recovery', () => {
  it('previews extraction without saving state, scheduling, or delivering alerts', async () => {
    const writes = set.mock.calls.length;
    const before = structuredClone(data);
    const scheduled = new Map(alarms);
    const reply = await rpc({
      type: 'test-selector',
      url: 'https://example.com/',
      selector: '#price',
    });
    expect(reply).toMatchObject({
      ok: true,
      value: { preview: { text: '41', source: 'tab', selector: '#price' } },
    });
    expect(data).toEqual(before);
    expect(alarms).toEqual(scheduled);
    expect(set).toHaveBeenCalledTimes(writes);
    expect(mocks.deliver).not.toHaveBeenCalled();
    expect(
      await rpc({
        type: 'test-selector',
        url: 'file:///secret',
        selector: '#price',
      }),
    ).toMatchObject({ ok: false });
  });

  it('rejects webpage, foreign, subframe, and malformed requests without side effects', async () => {
    const writes = set.mock.calls.length;
    for (const context of [
      {
        id: extensionId,
        url: 'https://example.com/',
        tab: { id: 1 },
        frameId: 0,
      },
      { id: 'other', url: sender.url, frameId: 0 },
      { ...sender, frameId: 1 },
    ]) {
      expect(
        await rpc(
          { type: 'delete', id: 'monitor1' },
          context as chrome.runtime.MessageSender,
        ),
      ).toMatchObject({ ok: false });
    }
    expect(
      await rpc({ type: 'fetch', url: 'https://evil.example' }),
    ).toMatchObject({ ok: false });
    expect(set).toHaveBeenCalledTimes(writes);
    expect(mocks.readRegion).not.toHaveBeenCalled();
  });
  it('serializes concurrent checks so the same change is recorded once', async () => {
    await Promise.all([
      rpc({ type: 'check', id: 'monitor1' }),
      rpc({ type: 'check', id: 'monitor1' }),
    ]);
    expect(current().history).toHaveLength(1);
    expect(mocks.deliver).toHaveBeenCalledTimes(1);
    expect(current().history[0].delivered).toBe(true);
  });
  it('retains baseline and does not notify after failed persistence', async () => {
    set.mockRejectedValueOnce(new Error('disk full'));
    await rpc({ type: 'check', id: 'monitor1' });
    expect(current().snapshot).toBe('40');
    expect(current().error).toBe('disk full');
    expect(mocks.deliver).not.toHaveBeenCalled();
  });
  it('expires a monitor without a page request', async () => {
    current().endsAt = Date.now() - 1;
    await rpc({ type: 'check', id: 'monitor1' });
    expect(current().enabled).toBe(false);
    expect(mocks.readRegion).not.toHaveBeenCalled();
    expect(alarms.has('monitor:monitor1')).toBe(false);
  });
  it('replays durable notifications after pause through the recovery alarm', async () => {
    mocks.deliver.mockRejectedValue(new Error('disabled'));
    await rpc({ type: 'check', id: 'monitor1' });
    expect(current().history[0].delivered).toBe(false);
    expect(alarms.has('pending-notifications')).toBe(true);
    await rpc({ type: 'toggle', id: 'monitor1', enabled: false });
    mocks.deliver.mockResolvedValue(undefined);
    mocks.readRegion.mockClear();
    onAlarm({ name: 'pending-notifications' });
    await rpc({ type: 'list' });
    expect(current().history[0].delivered).toBe(true);
    expect(current().error).toBeNull();
    expect(mocks.readRegion).not.toHaveBeenCalled();
  });
  it('does not evict undelivered changes when the history buffer is full', async () => {
    current().history = Array.from({ length: 10 }, (_, i) => ({
      id: String(i),
      at: i,
      before: 'a',
      after: 'b',
      delivered: false,
    }));
    mocks.deliver.mockRejectedValue(new Error('disabled'));
    await rpc({ type: 'check', id: 'monitor1' });
    expect(current().history).toHaveLength(10);
    expect(current().history.at(-1)?.id).toBe('9');
    expect(current().error).toContain('backlog');
    expect(mocks.readRegion).not.toHaveBeenCalled();
  });
});

it('persists rendering notice before first rendering and alerts once per monitor', async () => {
  mocks.readRegion.mockImplementation(async (_monitor, beforeRendering) => {
    await beforeRendering();
    expect(
      (data.pageMonitor as { monitors: Monitor[] }).monitors[0]
        .renderingRequired,
    ).toBe(true);
    return { text: 'Rendered', source: 'rendered' };
  });
  const first = await rpc({ type: 'check', id: 'monitor1' });
  expect(first.ok).toBe(true);
  expect(mocks.notifyRendering).toHaveBeenCalledOnce();
  const second = await rpc({ type: 'check', id: 'monitor1' });
  expect(second.ok).toBe(true);
  expect(mocks.notifyRendering).toHaveBeenCalledOnce();
  expect(
    (data.pageMonitor as { monitors: Monitor[] }).monitors[0],
  ).toMatchObject({
    renderingRequired: true,
    renderingNotified: true,
    source: 'rendered',
  });
});

it('keeps baseline and visible rendering requirement if the warning fails', async () => {
  mocks.notifyRendering.mockRejectedValue(new Error('Notifications disabled'));
  mocks.readRegion.mockImplementation(async (_monitor, beforeRendering) => {
    await beforeRendering();
    throw new Error('Must not render');
  });
  await rpc({ type: 'check', id: 'monitor1' });
  expect(
    (data.pageMonitor as { monitors: Monitor[] }).monitors[0],
  ).toMatchObject({
    snapshot: '40',
    history: [],
    renderingRequired: true,
    error: 'Notifications disabled',
  });
});

it('keeps read-only views responsive during checks and rejects duplicate checks', async () => {
  let finish: ((value: { text: string; source: string }) => void) | undefined;
  mocks.readRegion.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const checking = rpc({ type: 'check', id: 'monitor1' });
  await vi.waitFor(() => expect(finish).toBeDefined());
  expect(await rpc({ type: 'list' })).toMatchObject({
    ok: true,
    value: { checkingId: 'monitor1' },
  });
  expect(await rpc({ type: 'check', id: 'monitor1' })).toMatchObject({
    ok: false,
    error: 'A check is already in progress for this monitor.',
  });
  finish?.({ text: '40', source: 'tab' });
  expect(await checking).toMatchObject({ ok: true });
  expect(await rpc({ type: 'list' })).toMatchObject({
    ok: true,
    value: { checkingId: null },
  });
});

it('clears picker drafts through the trusted panel boundary and after editing', async () => {
  const remove = vi.mocked(chrome.storage.session.remove);
  remove.mockClear();
  expect(
    await rpc(
      { type: 'clear-draft' },
      { ...sender, url: 'https://example.com/' },
    ),
  ).toMatchObject({ ok: false });
  expect(remove).not.toHaveBeenCalled();
  expect(await rpc({ type: 'clear-draft' })).toMatchObject({ ok: true });
  expect(remove).toHaveBeenCalledWith('draft');
  remove.mockClear();
  expect(
    await rpc({
      type: 'update',
      id: 'monitor1',
      input: { ...base(), name: 'Renamed' },
    }),
  ).toMatchObject({ ok: true });
  expect(remove).toHaveBeenCalledWith('draft');
});

it('does not let an older picker consumption clear a newer selection', async () => {
  const draft = {
    url: 'https://example.com/',
    selector: '#new',
    sample: 'New region',
    title: 'Page',
  };
  vi.mocked(chrome.storage.session.get).mockImplementation(async () => ({
    draft,
  }));
  const remove = vi.mocked(chrome.storage.session.remove);
  remove.mockClear();
  expect(
    await rpc({
      type: 'clear-draft',
      expected: JSON.stringify({ ...draft, selector: '#old' }),
    }),
  ).toMatchObject({ ok: true });
  expect(remove).not.toHaveBeenCalled();
  expect(
    await rpc({ type: 'clear-draft', expected: JSON.stringify(draft) }),
  ).toMatchObject({ ok: true });
  expect(remove).toHaveBeenCalledWith('draft');
});

it('refreshes HTML without a text alert and preserves both snapshots on failure', async () => {
  mocks.readRegion.mockResolvedValue({
    text: '40',
    html: '<strong>40</strong>',
    source: 'tab',
  });
  const first = await rpc({ type: 'check', id: 'monitor1' });
  expect(first.ok && first.value.monitors[0]).toMatchObject({
    snapshot: '40',
    snapshotHtml: '<strong>40</strong>',
    unread: 0,
    history: [],
  });
  mocks.readRegion.mockRejectedValue(new Error('Offline'));
  const failed = await rpc({ type: 'check', id: 'monitor1' });
  expect(failed.ok && failed.value.monitors[0]).toMatchObject({
    snapshot: '40',
    snapshotHtml: '<strong>40</strong>',
    error: 'Offline',
  });
});
