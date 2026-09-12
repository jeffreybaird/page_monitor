// Self-contained: Chrome serializes this function into the isolated page world.
export function extractRegion(
  selector: string,
  expectedUrl?: string,
  doc: Document = document,
): { text: string } | { error: string } {
  if (expectedUrl && location.href !== expectedUrl)
    return { error: 'The tab navigated away. Open the monitored URL again.' };
  try {
    const matches = doc.querySelectorAll(selector);
    if (matches.length !== 1)
      return {
        error: matches.length
          ? 'Selection is ambiguous. Reselect the region.'
          : 'Selected region was not found. Sign in or reselect it; background HTML may not contain dynamic content.',
      };
    const element = matches[0];
    if (
      element.querySelector('input[type="password"]') ||
      (doc.querySelector('input[type="password"]') &&
        /\b(log\s*in|sign\s*in)\b/i.test(doc.title))
    )
      return {
        error:
          'The selected region contains a login form. Sign in again to continue checking.',
      };
    if (!(element instanceof HTMLElement))
      return { error: 'Select a text-containing HTML element.' };
    if (
      ['INPUT', 'TEXTAREA', 'SELECT', 'SCRIPT', 'STYLE', 'NOSCRIPT'].includes(
        element.tagName,
      ) ||
      element.isContentEditable
    )
      return { error: 'Form fields and editable content cannot be monitored.' };
    const copy = element.cloneNode(true) as HTMLElement;
    copy
      .querySelectorAll(
        'script,style,noscript,input,textarea,select,[contenteditable],[hidden],[aria-hidden="true"],[data-page-monitor-overlay]',
      )
      .forEach((n) => n.remove());
    const text = (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!text)
      return {
        error:
          'Selected region is empty. Check your session or select another region.',
      };
    if (text.length > 8000)
      return {
        error: 'Selected region is too large. Select a smaller region.',
      };
    return { text };
  } catch {
    return { error: 'The selector is invalid. Reselect the region.' };
  }
}
