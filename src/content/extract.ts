// Self-contained: Chrome serializes this function into the isolated page world.
export function extractRegion(
  selector: string,
  expectedUrl?: string,
  doc: Document = document,
): { text: string } | { error: string; renderable?: boolean } {
  if (expectedUrl && location.href !== expectedUrl)
    return { error: 'The tab navigated away. Open the monitored URL again.' };
  try {
    // Paths retain ordinary CSS selectors inside each document/shadow root.
    // Keep this validation local: Chrome serializes this function without imports.
    let root: Document | ShadowRoot = doc;
    let css = selector;
    if (selector.length > 2000) throw new Error('Invalid path');
    if (selector.startsWith('@page-monitor:')) {
      const steps: unknown = JSON.parse(selector.slice(14));
      if (!Array.isArray(steps) || steps.length < 2 || steps.length > 8)
        throw new Error('Invalid path');
      for (let i = 0; i < steps.length; i++) {
        const step: unknown = steps[i];
        if (
          !step ||
          typeof step !== 'object' ||
          !('css' in step) ||
          typeof step.css !== 'string' ||
          !step.css.trim()
        )
          throw new Error('Invalid path');
        const via = 'via' in step ? step.via : undefined;
        if (i === steps.length - 1) {
          if (via !== undefined) throw new Error('Invalid path');
          css = step.css;
          break;
        }
        if (via !== 'shadow' && via !== 'frame')
          throw new Error('Invalid path');
        const hosts: NodeListOf<Element> = root.querySelectorAll(step.css);
        if (hosts.length !== 1)
          return {
            error:
              'The selected component or frame is missing or ambiguous. Open the page and reselect the region.',
            renderable: hosts.length === 0,
          };
        const host: Element = hosts[0];
        if (via === 'shadow') {
          if (!host.shadowRoot)
            return {
              error:
                'This region needs JavaScript rendering or an open tab with an accessible web component.',
              renderable: true,
            };
          root = host.shadowRoot;
        } else {
          if (host.tagName !== 'IFRAME' && host.tagName !== 'FRAME')
            throw new Error('Invalid frame');
          const frame = host as HTMLIFrameElement;
          // Explicit origin check also protects against extension host permissions
          // making browser DOM access more permissive than the product policy.
          try {
            const child = frame.contentDocument;
            if (
              !child?.defaultView ||
              child.defaultView.origin !== doc.defaultView?.origin
            )
              return {
                error:
                  'This frame is unavailable or belongs to another site. Keep the page open; only same-origin frames are supported.',
                renderable: !doc.defaultView,
              };
            root = child;
          } catch {
            return {
              error:
                'This frame is unavailable or belongs to another site. Keep the page open; only same-origin frames are supported.',
              renderable: !doc.defaultView,
            };
          }
        }
      }
    }
    const matches = root.querySelectorAll(css);
    if (matches.length !== 1)
      return {
        error: matches.length
          ? 'Selection is ambiguous. Reselect the region.'
          : 'Selected region was not found. Sign in or reselect it; background HTML may not contain dynamic content.',
        renderable: matches.length === 0,
      };
    const element = matches[0];
    if (
      element.querySelector('input[type="password"]') ||
      (element.ownerDocument.querySelector('input[type="password"]') &&
        /\b(log\s*in|sign\s*in)\b/i.test(element.ownerDocument.title))
    )
      return {
        error:
          'The selected region contains a login form. Sign in again to continue checking.',
      };
    if (element.namespaceURI !== 'http://www.w3.org/1999/xhtml')
      return { error: 'Select a text-containing HTML element.' };
    if (
      ['INPUT', 'TEXTAREA', 'SELECT', 'SCRIPT', 'STYLE', 'NOSCRIPT'].includes(
        element.tagName,
      ) ||
      (element as HTMLElement).isContentEditable
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
        renderable: true,
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
