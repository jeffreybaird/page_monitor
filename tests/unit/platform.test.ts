import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../src/platform/api';
import * as firefox from '../../src/platform/firefox';
import * as chromePlatform from '../../src/platform/chrome';

afterEach(() => vi.unstubAllGlobals());

describe('browser platform boundaries', () => {
  it('uses the Firefox promise namespace even when the callback alias exists', () => {
    const promiseApi = { runtime: {} };
    vi.stubGlobal('browser', promiseApi);
    vi.stubGlobal('chrome', { runtime: {} });
    expect(api()).toBe(promiseApi);
    vi.stubGlobal('browser', undefined);
    expect(api()).toBe(chrome);
  });

  it('opens the Firefox sidebar in the toolbar gesture and handles rejection', async () => {
    let click: (() => void) | undefined;
    const open = vi.fn().mockRejectedValue(new Error('Sidebar unavailable'));
    const report = vi.fn();
    vi.stubGlobal('browser', {
      action: {
        onClicked: {
          addListener: (fn: () => void) => {
            click = fn;
          },
        },
      },
      sidebarAction: { open },
    });
    firefox.registerToolbar(report);
    click?.();
    expect(open).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Sidebar unavailable' }),
    );
  });

  it('does not call absent Chrome APIs on Firefox', async () => {
    vi.stubGlobal('browser', {});
    await expect(firefox.initializePlatform()).resolves.toBeUndefined();
    await expect(firefox.notificationsAllowed()).resolves.toBe(true);
    expect(firefox.notificationContext('example.com')).toEqual({});
  });

  it('keeps Chrome access restrictions and denied-notification behavior', async () => {
    vi.stubGlobal('browser', undefined);
    const localAccess = vi.fn();
    const sessionAccess = vi.fn();
    const panel = vi.fn();
    vi.stubGlobal('chrome', {
      storage: {
        local: { setAccessLevel: localAccess },
        session: { setAccessLevel: sessionAccess },
      },
      sidePanel: { setPanelBehavior: panel },
      notifications: {
        getPermissionLevel: vi.fn().mockResolvedValue('denied'),
      },
    });
    await chromePlatform.initializePlatform();
    expect(localAccess).toHaveBeenCalledWith({
      accessLevel: 'TRUSTED_CONTEXTS',
    });
    expect(sessionAccess).toHaveBeenCalledWith({
      accessLevel: 'TRUSTED_CONTEXTS',
    });
    expect(panel).toHaveBeenCalledWith({ openPanelOnActionClick: true });
    expect(await chromePlatform.notificationsAllowed()).toBe(false);
  });

  it('extracts from an inert full Firefox document without touching the background DOM', async () => {
    document.body.innerHTML = '<p id="price">Background</p>';
    const result = await firefox.parseHTML(
      '<html><body><p id="price">42</p><script>document.body.textContent="executed"</script></body></html>',
      'html > body > #price',
    );
    expect(result).toMatchObject({ text: '42' });
    expect(document.body.textContent).toBe('Background');
    expect(await firefox.parseHTML('<p>Missing</p>', '#price')).toHaveProperty(
      'error',
    );
  });
});
