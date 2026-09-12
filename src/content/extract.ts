// Self-contained: Chrome serializes this function into the isolated page world.
export function extractRegion(
  selector: string,
  expectedUrl?: string,
  doc: Document | DocumentFragment = document,
): { text: string; html?: string } | { error: string; renderable?: boolean } {
  if (expectedUrl && location.href !== expectedUrl)
    return { error: 'The tab navigated away. Open the monitored URL again.' };
  try {
    // Paths retain ordinary CSS selectors inside each document/shadow root.
    // Keep this validation local: Chrome serializes this function without imports.
    let root: Document | DocumentFragment = doc;
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
              child.defaultView.origin !==
                ('defaultView' in doc ? doc.defaultView?.origin : undefined)
            )
              return {
                error:
                  'This frame is unavailable or belongs to another site. Keep the page open; only same-origin frames are supported.',
                renderable: !('defaultView' in doc && doc.defaultView),
              };
            root = child;
          } catch {
            return {
              error:
                'This frame is unavailable or belongs to another site. Keep the page open; only same-origin frames are supported.',
              renderable: !('defaultView' in doc && doc.defaultView),
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
    const inertDocument =
      element.ownerDocument.createElement('template').content.ownerDocument;
    const copy = inertDocument.importNode(element, true) as HTMLElement;
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
    // Reconstruct a small HTML vocabulary rather than copying source attributes.
    // Self-contained because executeScript serializes this function without imports.
    const allowed = new Set(
      'div span p br hr h1 h2 h3 h4 h5 h6 strong b em i u s del ins small sub sup mark code pre blockquote ul ol li dl dt dd table caption thead tbody tfoot tr th td'.split(
        ' ',
      ),
    );
    const blocked = new Set(
      'script style noscript input textarea select button form iframe frame object embed svg math template link meta base audio video source canvas'.split(
        ' ',
      ),
    );
    const output = element.ownerDocument.createElement('div');
    let nodes = 0;
    let overflow = false;
    const append = (source: Node, parent: Node, depth: number): void => {
      if (++nodes > 2000 || depth > 40) {
        overflow = true;
        return;
      }
      if (source.nodeType === 3) {
        parent.appendChild(
          element.ownerDocument.createTextNode(source.textContent ?? ''),
        );
        return;
      }
      if (source.nodeType !== 1) return;
      const node = source as Element;
      const tag = node.localName;
      if (
        blocked.has(tag) ||
        node.namespaceURI !== 'http://www.w3.org/1999/xhtml'
      )
        return;
      if (tag === 'img') {
        parent.appendChild(
          element.ownerDocument.createTextNode(node.getAttribute('alt') ?? ''),
        );
        return;
      }
      const safe = allowed.has(tag)
        ? element.ownerDocument.createElement(tag)
        : null;
      if (safe) {
        if (tag === 'td' || tag === 'th') {
          for (const attr of ['colspan', 'rowspan']) {
            const value = node.getAttribute(attr);
            if (value && /^[1-9]\d?$/.test(value))
              safe.setAttribute(attr, value);
          }
        }
        parent.appendChild(safe);
      }
      for (const child of node.childNodes)
        append(child, safe ?? parent, depth + 1);
    };
    append(copy, output, 0);
    const html = output.innerHTML;
    return { text, ...(overflow || html.length > 64000 ? {} : { html }) };
  } catch {
    return { error: 'The selector is invalid. Reselect the region.' };
  }
}
