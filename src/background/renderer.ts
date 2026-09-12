import { extractRegion } from '../content/extract';
import { originPattern, webUrl } from '../shared/model';

export const RENDER_CLEANUP_ALARM = 'render-cleanup';
const PREFIX = 'render-tab:';
const TIMEOUT = 20_000;
// Tab activation can arrive before tabs.create resolves or ownership is stored.
// Capture it only while acquiring a tab; overflow conservatively abandons acquisition.
const acquisitions = new Set<{ claimed: Set<number>; overflow: boolean }>();
const OWNERSHIP_LOST =
  'The temporary tab was opened or closed by the user. Check again to use the open tab.';

async function scheduleCleanup() {
  await chrome.alarms.create(RENDER_CLEANUP_ALARM, {
    when: Date.now() + 30_000,
  });
}

export async function releaseRenderingTab(tabId: number): Promise<void> {
  for (const acquisition of acquisitions) {
    if (acquisition.claimed.size < 256) acquisition.claimed.add(tabId);
    else acquisition.overflow = true;
  }
  await chrome.storage.session.remove(`${PREFIX}${tabId}`);
}

async function owned(tabId: number): Promise<boolean> {
  const key = `${PREFIX}${tabId}`;
  return (await chrome.storage.session.get(key))[key] === true;
}

async function cleanupTab(tabId: number): Promise<void> {
  if (!(await owned(tabId))) return;
  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch (error) {
    if (
      error instanceof Error &&
      /No tab with id|Invalid tab ID/i.test(error.message)
    ) {
      // A closed tab has no work left to recover.
      await releaseRenderingTab(tabId);
    } else {
      await scheduleCleanup();
    }
    return;
  }
  if (tab.active) {
    await releaseRenderingTab(tabId);
    return;
  }
  // Activation releases ownership independently of the check queue.
  if (!(await owned(tabId))) return;
  try {
    await chrome.tabs.remove(tabId);
    await releaseRenderingTab(tabId);
  } catch {
    // For example, Chrome can reject edits while a tab is being dragged.
    // Retain ownership so a later alarm or worker restart can retry.
    await scheduleCleanup();
  }
}

export async function cleanupRenderingTabs(): Promise<void> {
  const values = await chrome.storage.session.get(null);
  for (const [key, value] of Object.entries(values)) {
    if (!key.startsWith(PREFIX) || value !== true) continue;
    const id = Number(key.slice(PREFIX.length));
    if (Number.isSafeInteger(id) && id >= 0) await cleanupTab(id);
  }
}

async function permission(url: string) {
  if (!(await chrome.permissions.contains({ origins: [originPattern(url)] })))
    throw new Error(
      'Site access was removed. Grant access from the monitor settings.',
    );
}

function bounded<T>(operation: Promise<T>, remaining: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    operation,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('Rendering timed out.')),
        Math.max(1, remaining),
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

async function acquireTab(): Promise<number> {
  const acquisition = { claimed: new Set<number>(), overflow: false };
  acquisitions.add(acquisition);
  const claimed = (id: number) =>
    acquisition.overflow || acquisition.claimed.has(id);
  try {
    const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
    if (tab.id === undefined)
      throw new Error('Could not create a temporary tab.');
    const id = tab.id;
    if (tab.active || claimed(id)) throw new Error(OWNERSHIP_LOST);
    try {
      await chrome.storage.session.set({ [`${PREFIX}${id}`]: true });
    } catch (error) {
      // Even if it is inactive again, an activated blank tab belongs to the user.
      const current = await chrome.tabs.get(id);
      if (!current.active && !claimed(id)) await chrome.tabs.remove(id);
      throw error;
    }
    if (claimed(id)) {
      await chrome.storage.session.remove(`${PREFIX}${id}`);
      throw new Error(OWNERSHIP_LOST);
    }
    return id;
  } finally {
    acquisitions.delete(acquisition);
  }
}

export async function renderRegion(
  url: string,
  selector: string,
): Promise<string> {
  url = webUrl(url);
  await permission(url);
  const id = await acquireTab();
  let lastError = 'The selected region did not become available.';
  try {
    await scheduleCleanup();
    const deadline = Date.now() + TIMEOUT;
    // tabs.create can resolve before its initial blank navigation commits.
    // Updating too early can race that navigation and leave the target unloaded.
    while (true) {
      if (Date.now() >= deadline)
        throw new Error(
          'The temporary tab did not finish opening. Try the check again.',
        );
      const current = await chrome.tabs.get(id);
      if (!(await owned(id)) || current.active) throw new Error(OWNERSHIP_LOST);
      await permission(url);
      if (current.url && current.url !== 'about:blank')
        throw new Error(
          'The temporary tab navigated away before the check started.',
        );
      if (current.url === 'about:blank' && current.status === 'complete') break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await chrome.tabs.update(id, { url, muted: true, autoDiscardable: false });
    let previous: string | undefined;
    let stableSince = 0;
    while (Date.now() < deadline) {
      if (!(await owned(id))) throw new Error(OWNERSHIP_LOST);
      const current = await chrome.tabs.get(id);
      if (current.active) {
        await releaseRenderingTab(id);
        throw new Error(OWNERSHIP_LOST);
      }
      const navigated = current.url && current.url !== 'about:blank';
      if (
        (navigated && current.url !== url) ||
        (current.pendingUrl && current.pendingUrl !== url)
      )
        throw new Error(
          'The page redirected, possibly to sign in. Open the monitored URL and check your session.',
        );
      await permission(url);
      if (current.url === url && current.status === 'complete') {
        let value: unknown;
        try {
          const results = await bounded(
            chrome.scripting.executeScript({
              target: { tabId: id },
              injectImmediately: true,
              func: extractRegion,
              args: [selector, url],
            }),
            deadline - Date.now(),
          );
          value = results[0]?.result;
        } catch {
          lastError =
            'The page could not be read before the rendering timeout.';
        }
        if (!(await owned(id))) throw new Error(OWNERSHIP_LOST);
        await permission(url);
        if (
          value &&
          typeof value === 'object' &&
          'error' in value &&
          typeof value.error === 'string'
        ) {
          lastError = value.error;
          if (
            !('renderable' in value && value.renderable === true) &&
            /login form|selector is invalid|ambiguous|too large|cannot be monitored|navigated away/.test(
              lastError,
            )
          )
            throw new Error(lastError);
          previous = undefined;
        } else if (
          value &&
          typeof value === 'object' &&
          'text' in value &&
          typeof value.text === 'string' &&
          value.text.trim() &&
          value.text.length <= 8000
        ) {
          if (value.text !== previous) {
            previous = value.text;
            stableSince = Date.now();
          } else if (Date.now() - stableSince >= 1000) {
            const latest = await chrome.tabs.get(id);
            if (latest.active || !(await owned(id))) {
              await releaseRenderingTab(id);
              throw new Error(OWNERSHIP_LOST);
            }
            if (
              latest.url !== url ||
              (latest.pendingUrl && latest.pendingUrl !== url)
            )
              throw new Error(
                'The tab navigated away before the check completed. Open the monitored URL and check your session.',
              );
            if (latest.status === 'complete') return value.text;
            previous = undefined;
          }
        } else {
          previous = undefined;
        }
      } else {
        previous = undefined;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(
      `JavaScript rendering timed out. ${lastError} Keep the page open and check your session.`,
    );
  } finally {
    await cleanupTab(id);
  }
}
