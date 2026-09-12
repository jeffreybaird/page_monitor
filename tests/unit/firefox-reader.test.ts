import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readRegion } from '../../src/background/reader';
import { renderRegion } from '../../src/background/renderer';

vi.mock('#platform', () => import('../../src/platform/firefox'));
vi.mock('../../src/background/renderer', () => ({ renderRegion: vi.fn() }));

const monitor = { url: 'http://localhost:8123/price', selector: '#price' };
const contains = vi.fn();
const query = vi.fn();
const executeScript = vi.fn();
const fetchPage = vi.fn();
const beforeRendering = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  contains.mockResolvedValue(true);
  query.mockResolvedValue([]);
  executeScript.mockResolvedValue([{ result: { text: '$42' } }]);
  fetchPage.mockResolvedValue(
    new Response('<p id="price">$42</p>', {
      headers: { 'content-type': 'text/html' },
    }),
  );
  vi.stubGlobal('fetch', fetchPage);
  vi.stubGlobal('browser', {
    permissions: { contains },
    tabs: { query },
    scripting: { executeScript },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('Firefox reader session boundaries', () => {
  it.each(['firefox-container-1', undefined])(
    'rejects a matching tab with unsupported cookie store %s before reading or rendering',
    async (cookieStoreId) => {
      query.mockResolvedValue([
        { id: 1, url: monitor.url, active: true, cookieStoreId },
      ]);
      await expect(
        readRegion({ ...monitor, renderJavaScript: true }, beforeRendering),
      ).rejects.toThrow('container tabs are unsupported');
      expect(executeScript).not.toHaveBeenCalled();
      expect(fetchPage).not.toHaveBeenCalled();
      expect(renderRegion).not.toHaveBeenCalled();
      expect(beforeRendering).not.toHaveBeenCalled();
    },
  );

  it('reads the default-session tab even when a matching container tab is active', async () => {
    query.mockResolvedValue([
      {
        id: 1,
        url: monitor.url,
        active: true,
        cookieStoreId: 'firefox-container-1',
      },
      {
        id: 2,
        url: monitor.url,
        active: false,
        cookieStoreId: 'firefox-default',
      },
    ]);
    await expect(readRegion(monitor, beforeRendering)).resolves.toEqual({
      text: '$42',
      source: 'tab',
    });
    expect(executeScript).toHaveBeenCalledOnce();
    expect(executeScript).toHaveBeenCalledWith(
      expect.objectContaining({ target: { tabId: 2 } }),
    );
    expect(fetchPage).not.toHaveBeenCalled();
    expect(renderRegion).not.toHaveBeenCalled();
  });

  it('uses a port-free permission pattern while fetching the exact saved URL', async () => {
    await expect(readRegion(monitor, beforeRendering)).resolves.toMatchObject({
      text: '$42',
      source: 'background',
    });
    expect(contains).toHaveBeenCalledWith({ origins: ['http://localhost/*'] });
    expect(query).toHaveBeenCalledWith({ url: 'http://localhost/*' });
    expect(fetchPage).toHaveBeenCalledWith(
      monitor.url,
      expect.objectContaining({ credentials: 'include', redirect: 'manual' }),
    );
    expect(executeScript).not.toHaveBeenCalled();
    expect(renderRegion).not.toHaveBeenCalled();
  });

  it('rejects revoked access before inspecting tabs or using the browser session', async () => {
    contains.mockResolvedValue(false);
    await expect(readRegion(monitor, beforeRendering)).rejects.toThrow(
      'Site access was removed',
    );
    expect(query).not.toHaveBeenCalled();
    expect(fetchPage).not.toHaveBeenCalled();
    expect(executeScript).not.toHaveBeenCalled();
    expect(renderRegion).not.toHaveBeenCalled();
  });
});
