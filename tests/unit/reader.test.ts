import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readRegion } from '../../src/background/reader';
import { extractRegion } from '../../src/content/extract';

vi.mock('../../src/background/renderer', () => ({
  renderRegion: vi.fn().mockResolvedValue({ text: 'Rendered' }),
}));
const monitor = { url: 'https://example.com/price', selector: '#price' };
const contains = vi.fn();
const query = vi.fn();
const executeScript = vi.fn();
const fetchPage = vi.fn();
const sendMessage = vi.fn();
const closeDocument = vi.fn();
const reload = vi.fn();
const update = vi.fn();
const create = vi.fn();

beforeEach(async () => {
  vi.resetAllMocks();
  const { renderRegion } = await import('../../src/background/renderer');
  vi.mocked(renderRegion).mockResolvedValue({ text: 'Rendered' });
  contains.mockResolvedValue(true);
  query.mockResolvedValue([]);
  executeScript.mockResolvedValue([{ result: { text: '$42' } }]);
  sendMessage.mockResolvedValue({ text: '$42' });
  fetchPage.mockResolvedValue(
    new Response('<p id="price">$42</p>', {
      headers: { 'content-type': 'text/html' },
    }),
  );
  vi.stubGlobal('fetch', fetchPage);
  vi.stubGlobal('chrome', {
    permissions: { contains },
    tabs: { query, reload, update, create },
    scripting: { executeScript },
    runtime: { sendMessage },
    offscreen: {
      hasDocument: vi.fn().mockResolvedValue(true),
      closeDocument,
    },
  });
});
afterEach(() => {
  expect(reload).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe('open-tab readiness', () => {
  it('reads the selected DOM immediately even while the tab is loading', async () => {
    query.mockResolvedValue([
      { id: 1, url: monitor.url, status: 'loading', discarded: false },
    ]);
    await expect(readRegion(monitor, async () => {})).resolves.toEqual({
      text: '$42',
      source: 'tab',
    });
    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 1 },
      injectImmediately: true,
      func: extractRegion,
      args: ['#price', monitor.url],
    });
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('prefers a loaded duplicate over an active discarded tab', async () => {
    query.mockResolvedValue([
      { id: 1, url: monitor.url, active: true, discarded: true },
      { id: 2, url: monitor.url, active: false, discarded: false },
    ]);
    await expect(readRegion(monitor, async () => {})).resolves.toHaveProperty(
      'source',
      'tab',
    );
    expect(executeScript).toHaveBeenCalledWith(
      expect.objectContaining({ target: { tabId: 2 } }),
    );
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('still prefers the active tab among readable duplicates', async () => {
    query.mockResolvedValue([
      { id: 1, url: monitor.url, active: false, discarded: false },
      { id: 2, url: monitor.url, active: true, discarded: false },
    ]);
    await readRegion(monitor, async () => {});
    expect(executeScript).toHaveBeenCalledWith(
      expect.objectContaining({ target: { tabId: 2 } }),
    );
  });

  it('leaves discarded tabs untouched and explains how to resume checks', async () => {
    query.mockResolvedValue([
      { id: 1, url: monitor.url, discarded: true },
      { id: 2, url: monitor.url, discarded: true },
    ]);
    await expect(readRegion(monitor, async () => {})).rejects.toThrow(
      'Chrome unloaded this tab to save memory. Activate it to resume tab checks, or close it to allow background checks.',
    );
    expect(executeScript).not.toHaveBeenCalled();
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('preserves extraction failures without fetching behind an open tab', async () => {
    query.mockResolvedValue([{ id: 1, url: monitor.url, status: 'loading' }]);
    executeScript.mockResolvedValue([
      { result: { error: 'The selected region is missing.' } },
    ]);
    await expect(readRegion(monitor, async () => {})).rejects.toThrow(
      'The selected region is missing.',
    );
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('propagates unavailable content-script errors without a network fallback', async () => {
    query.mockResolvedValue([{ id: 1, url: monitor.url }]);
    executeScript.mockRejectedValue(new Error('Cannot access this page.'));
    await expect(readRegion(monitor, async () => {})).rejects.toThrow(
      'Cannot access this page.',
    );
    expect(fetchPage).not.toHaveBeenCalled();
  });
});

describe('reader access and background checks', () => {
  it('rejects revoked access before touching any tab or network', async () => {
    contains.mockResolvedValue(false);
    await expect(readRegion(monitor, async () => {})).rejects.toThrow(
      'Site access was removed.',
    );
    expect(query).not.toHaveBeenCalled();
    expect(executeScript).not.toHaveBeenCalled();
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('fetches with the session only when no eligible matching tab exists', async () => {
    query.mockResolvedValue([
      { id: 1, url: 'https://example.com/other', discarded: false },
      { id: 2, url: monitor.url, incognito: true, discarded: false },
    ]);
    await expect(readRegion(monitor, async () => {})).resolves.toEqual({
      text: '$42',
      source: 'background',
    });
    expect(executeScript).not.toHaveBeenCalled();
    expect(fetchPage).toHaveBeenCalledWith(
      monitor.url,
      expect.objectContaining({
        credentials: 'include',
        cache: 'no-store',
        redirect: 'manual',
      }),
    );
    expect(closeDocument).toHaveBeenCalledOnce();
  });
});

it('alerts before rendering missing background content, and not for HTTP/auth failures', async () => {
  const { renderRegion } = await import('../../src/background/renderer');
  const before = vi.fn(async () => {
    expect(renderRegion).not.toHaveBeenCalled();
  });
  sendMessage.mockResolvedValue({
    error: 'Missing dynamic region',
    renderable: true,
  });
  await expect(readRegion(monitor, before)).resolves.toEqual({
    text: 'Rendered',
    source: 'rendered',
  });
  expect(before).toHaveBeenCalledOnce();
  expect(renderRegion).toHaveBeenCalledWith(monitor.url, monitor.selector);
  vi.mocked(renderRegion).mockClear();
  before.mockClear();
  fetchPage.mockResolvedValue(new Response('', { status: 401 }));
  await expect(readRegion(monitor, before)).rejects.toThrow('HTTP 401');
  expect(before).not.toHaveBeenCalled();
  expect(renderRegion).not.toHaveBeenCalled();
});

it('never creates a rendering tab if its warning cannot be delivered', async () => {
  const { renderRegion } = await import('../../src/background/renderer');
  sendMessage.mockResolvedValue({ error: 'Missing', renderable: true });
  await expect(
    readRegion(monitor, async () => {
      throw new Error('Notifications disabled');
    }),
  ).rejects.toThrow('Notifications disabled');
  expect(renderRegion).not.toHaveBeenCalled();
});
