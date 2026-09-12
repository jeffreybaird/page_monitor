import { extractRegion } from '../content/extract';
// Parse untrusted HTML only in an inert document; never insert it into this page.
chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  if (
    sender.id !== chrome.runtime.id ||
    sender.url !== chrome.runtime.getURL('background.js') ||
    !message ||
    typeof message !== 'object'
  )
    return;
  const m = message as Record<string, unknown>;
  if (
    m.type !== 'parse' ||
    typeof m.html !== 'string' ||
    m.html.length > 2_000_000 ||
    typeof m.selector !== 'string' ||
    m.selector.length > 2000
  )
    return;
  const parsed = new DOMParser().parseFromString(m.html, 'text/html');
  respond(extractRegion(m.selector, undefined, parsed));
});
