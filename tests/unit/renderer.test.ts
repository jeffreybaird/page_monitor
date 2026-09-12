import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanupRenderingTabs,
  releaseRenderingTab,
  renderRegion,
  RENDER_CLEANUP_ALARM,
} from '../../src/background/renderer';

const url = 'https://example.com/price';
let session: Record<string, unknown>;
let tab: {
  id: number;
  active: boolean;
  url: string;
  pendingUrl?: string;
  status: 'loading' | 'complete';
};
const contains = vi.fn();
const create = vi.fn();
const update = vi.fn();
const get = vi.fn();
const remove = vi.fn();
const set = vi.fn();
const alarm = vi.fn();
const executeScript = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  session = {};
  tab = { id: 7, active: false, url: 'about:blank', status: 'complete' };
  contains.mockResolvedValue(true);
  create.mockResolvedValue(tab);
  get.mockImplementation(async () => ({ ...tab }));
  update.mockImplementation(async (_id, changes) => {
    expect(session['render-tab:7']).toBe(true);
    expect(alarm).toHaveBeenCalled();
    tab = { ...tab, ...changes };
    return tab;
  });
  set.mockImplementation(async (values) => Object.assign(session, values));
  executeScript.mockResolvedValue([{ result: { text: '$42' } }]);
  vi.stubGlobal('chrome', {
    permissions: { contains },
    tabs: { create, update, get, remove },
    alarms: { create: alarm },
    scripting: { executeScript },
    storage: {
      session: {
        get: vi.fn(async (key) =>
          key === null ? { ...session } : { [key]: session[key] },
        ),
        set,
        remove: vi.fn(async (key) => {
          delete session[key];
        }),
      },
    },
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function finish(promise: Promise<unknown>, milliseconds = 1500) {
  const outcome = promise.then(
    (value) => ({ value }),
    (error: Error) => ({ error }),
  );
  await vi.advanceTimersByTimeAsync(milliseconds);
  return outcome;
}

describe('temporary JavaScript rendering', () => {
  it('owns and schedules cleanup before navigating an inactive muted tab, and waits for stable text', async () => {
    const outcome = await finish(renderRegion(url, '#price'));
    expect(outcome).toEqual({ value: { text: '$42' } });
    expect(create).toHaveBeenCalledWith({ url: 'about:blank', active: false });
    expect(update).toHaveBeenCalledWith(7, {
      url,
      muted: true,
      autoDiscardable: false,
    });
    expect(alarm).toHaveBeenCalledWith(
      RENDER_CLEANUP_ALARM,
      expect.any(Object),
    );
    expect(executeScript).toHaveBeenCalledTimes(3);
    expect(remove).toHaveBeenCalledWith(7);
    expect(session).toEqual({});
  });

  it('waits through missing JS content and resets stability when content changes', async () => {
    executeScript
      .mockResolvedValueOnce([
        { result: { error: 'Selected region was not found.' } },
      ])
      .mockResolvedValueOnce([{ result: { text: 'Loading' } }]);
    expect(await finish(renderRegion(url, '#price'), 2500)).toEqual({
      value: { text: '$42' },
    });
    expect(executeScript).toHaveBeenCalledTimes(5);
  });

  it('waits for initial blank navigation to finish before navigating its owned tab', async () => {
    tab.status = 'loading';
    const result = renderRegion(url, '#price');
    await vi.advanceTimersByTimeAsync(500);
    expect(update).not.toHaveBeenCalled();
    expect(session['render-tab:7']).toBe(true);
    tab.status = 'complete';
    expect(await finish(result, 2000)).toEqual({ value: { text: '$42' } });
    expect(update).toHaveBeenCalledOnce();
  });

  it('ignores a matching placeholder until the page finishes loading', async () => {
    update.mockImplementation(async (_id, changes) => {
      tab = { ...tab, ...changes, status: 'loading' };
      return tab;
    });
    executeScript.mockResolvedValue([{ result: { text: 'Loading' } }]);
    const result = renderRegion(url, '#price');
    await vi.advanceTimersByTimeAsync(2000);
    expect(executeScript).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    tab.status = 'complete';
    executeScript.mockResolvedValue([{ result: { text: '$42' } }]);
    expect(await finish(result, 2000)).toEqual({ value: { text: '$42' } });
  });

  it('does not reclaim a tab activated before creation resolves even if inactive again', async () => {
    create.mockImplementation(async () => {
      await releaseRenderingTab(7);
      return { ...tab, active: false };
    });
    const outcome = await finish(renderRegion(url, '#price'));
    expect(outcome).toHaveProperty('error');
    expect(set).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('forgets ownership written after user activation during persistence', async () => {
    set.mockImplementation(async (values) => {
      await releaseRenderingTab(7);
      Object.assign(session, values);
    });
    const outcome = await finish(renderRegion(url, '#price'));
    expect(outcome).toHaveProperty('error');
    expect(session).toEqual({});
    expect(update).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('preserves an activated tab when ownership storage fails', async () => {
    set.mockImplementation(async () => {
      await releaseRenderingTab(7);
      throw new Error('Storage failed');
    });
    await expect(renderRegion(url, '#price')).rejects.toThrow('Storage failed');
    expect(update).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('denies revoked access before creating anything', async () => {
    contains.mockResolvedValue(false);
    await expect(renderRegion(url, '#price')).rejects.toThrow(
      'Site access was removed',
    );
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('stops and closes its own tab when permission is revoked during rendering', async () => {
    executeScript.mockImplementation(async () => {
      contains.mockResolvedValue(false);
      return [{ result: { text: '$42' } }];
    });
    const outcome = await finish(renderRegion(url, '#price'));
    expect(outcome).toHaveProperty(
      'error.message',
      'Site access was removed. Grant access from the monitor settings.',
    );
    expect(remove).toHaveBeenCalledWith(7);
  });

  it('rejects redirects without injecting or accepting login content', async () => {
    update.mockImplementation(async () => {
      tab.url = 'https://example.com/login';
    });
    const outcome = await finish(renderRegion(url, '#price'));
    expect(outcome).toHaveProperty(
      'error.message',
      'The page redirected, possibly to sign in. Open the monitored URL and check your session.',
    );
    expect(executeScript).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith(7);
  });

  it('rejects detected login forms immediately and cleans up', async () => {
    executeScript.mockResolvedValue([
      {
        result: {
          error:
            'The selected region contains a login form. Sign in again to continue checking.',
        },
      },
    ]);
    const outcome = await finish(renderRegion(url, '#price'));
    expect(outcome).toHaveProperty(
      'error.message',
      'The selected region contains a login form. Sign in again to continue checking.',
    );
    expect(executeScript).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith(7);
  });

  it('times out stalled script execution and removes the owned tab', async () => {
    executeScript.mockImplementation(() => new Promise(() => {}));
    const outcome = await finish(renderRegion(url, '#price'), 21_000);
    expect(outcome).toHaveProperty('error');
    if ('error' in outcome)
      expect(outcome.error.message).toContain('rendering timed out');
    expect(remove).toHaveBeenCalledWith(7);
    expect(session).toEqual({});
  });

  it('preserves a tab activated by the user and discards its result', async () => {
    executeScript.mockImplementation(async () => {
      tab.active = true;
      await releaseRenderingTab(7);
      return [{ result: { text: '$42' } }];
    });
    const outcome = await finish(renderRegion(url, '#price'));
    expect(outcome).toHaveProperty('error');
    expect(remove).not.toHaveBeenCalled();
    expect(session).toEqual({});
  });

  it('does not navigate a tab when ownership persistence fails', async () => {
    set.mockRejectedValue(new Error('Storage failed'));
    await expect(renderRegion(url, '#price')).rejects.toThrow('Storage failed');
    expect(update).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith(7);
  });
});

describe('temporary tab recovery', () => {
  it('recovers only owned inactive tabs and leaves unrelated session data intact', async () => {
    session = {
      'render-tab:7': true,
      'render-tab:8': true,
      pendingPick: {},
      'render-tab:wrong': true,
    };
    get.mockImplementation(async (id) => ({ id, active: id === 8 }));
    await cleanupRenderingTabs();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(7);
    expect(session).toEqual({ pendingPick: {}, 'render-tab:wrong': true });
  });

  it('retains ownership and reschedules cleanup after a failed close', async () => {
    session = { 'render-tab:7': true };
    remove.mockRejectedValueOnce(new Error('Tab is being dragged'));
    await cleanupRenderingTabs();
    expect(session).toEqual({ 'render-tab:7': true });
    expect(alarm).toHaveBeenCalledWith(
      RENDER_CLEANUP_ALARM,
      expect.any(Object),
    );
    await cleanupRenderingTabs();
    expect(session).toEqual({});
  });

  it('forgets tabs that are already closed', async () => {
    session = { 'render-tab:7': true };
    get.mockRejectedValue(new Error('No tab with id: 7'));
    await cleanupRenderingTabs();
    expect(session).toEqual({});
    expect(remove).not.toHaveBeenCalled();
  });
});

it('waits for a component that is still being created after page load', async () => {
  executeScript.mockResolvedValueOnce([
    {
      result: {
        error:
          'The selected component or frame is missing or ambiguous. Open the page and reselect the region.',
        renderable: true,
      },
    },
  ]);
  expect(
    await finish(
      renderRegion(
        url,
        '@page-monitor:[{"css":"price-card","via":"shadow"},{"css":"p"}]',
      ),
      2000,
    ),
  ).toEqual({ value: { text: '$42' } });
  expect(remove).toHaveBeenCalledWith(7);
});
