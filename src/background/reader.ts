import { extractRegion } from '../content/extract';
import { originPattern, type Monitor } from '../shared/model';
export async function readRegion(
  m: Pick<Monitor, 'url' | 'selector'>,
): Promise<{ text: string; source: 'tab' | 'background' }> {
  if (!(await chrome.permissions.contains({ origins: [originPattern(m.url)] })))
    throw new Error(
      'Site access was removed. Grant access from the monitor settings.',
    );
  const tabs = await chrome.tabs.query({ url: originPattern(m.url) });
  const matching = tabs
    .filter((t) => t.url === m.url && !t.incognito)
    .sort(
      (a, b) =>
        Number(!!a.discarded) - Number(!!b.discarded) ||
        Number(b.active) - Number(a.active),
    );
  const existing = matching[0];
  if (existing) {
    if (existing.discarded)
      throw new Error(
        'Chrome unloaded this tab to save memory. Activate it to resume tab checks, or close it to allow background checks. Page Monitor will not reload it.',
      );
    if (existing.id === undefined) throw new Error('The tab is unavailable.');
    const results = await chrome.scripting.executeScript({
      target: { tabId: existing.id },
      // A page can have readable content while slow assets keep it loading.
      injectImmediately: true,
      func: extractRegion,
      args: [m.selector, m.url],
    });
    const value: unknown = results[0]?.result;
    return { text: checkedText(value), source: 'tab' };
  }
  const response = await fetch(m.url, {
    credentials: 'include',
    cache: 'no-store',
    redirect: 'manual',
    signal: AbortSignal.timeout(12000),
  });
  if (
    response.type === 'opaqueredirect' ||
    (response.status >= 300 && response.status < 400)
  )
    throw new Error(
      'The page redirected, possibly to sign in. Open the monitored URL and check your session.',
    );
  if (!response.ok)
    throw new Error(
      `Background check failed (HTTP ${response.status}). Open the page to check your session.`,
    );
  if (!response.headers.get('content-type')?.includes('text/html'))
    throw new Error('Background monitoring requires an HTML page.');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty response.');
  const decoder = new TextDecoder();
  let html = '';
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 2_000_000)
        throw new Error(
          'Page exceeds the 2 MB background-check limit. Keep its tab open.',
        );
      html += decoder.decode(value, { stream: true });
    }
    html += decoder.decode();
  } finally {
    await reader.cancel();
  }
  if (!(await chrome.offscreen.hasDocument()))
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: [chrome.offscreen.Reason.DOM_PARSER],
      justification:
        'Extract the selected text from HTML fetched using the browser session.',
    });
  try {
    const value: unknown = await chrome.runtime.sendMessage({
      type: 'parse',
      html,
      selector: m.selector,
    });
    return { text: checkedText(value), source: 'background' };
  } finally {
    await chrome.offscreen.closeDocument();
  }
}
function checkedText(value: unknown): string {
  if (!value || typeof value !== 'object')
    throw new Error('No page content was returned.');
  if ('error' in value && typeof value.error === 'string')
    throw new Error(value.error);
  if (
    !('text' in value) ||
    typeof value.text !== 'string' ||
    value.text.length > 8000
  )
    throw new Error('Invalid page content.');
  return value.text;
}
