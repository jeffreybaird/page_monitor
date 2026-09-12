import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Monitor, Reply } from '../../src/shared/model';
const mocks = vi.hoisted(() => ({
  readRegion: vi.fn(),
  deliver: vi.fn(),
  updateBadge: vi.fn(),
}));
vi.mock('../../src/background/reader', () => ({
  readRegion: mocks.readRegion,
}));
vi.mock('../../src/background/notifiers', () => ({
  deliver: mocks.deliver,
  updateBadge: mocks.updateBadge,
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
        get: async () => ({}),
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
