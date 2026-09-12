// All helpers stay inside this function so executeScript can serialize it.
export function startPicker(token: string): void {
  const previous = document.querySelector('[data-page-monitor-overlay]');
  previous?.dispatchEvent(new Event('page-monitor-cleanup'));
  const host = document.createElement('div');
  host.dataset.pageMonitorOverlay = 'true';
  host.style.cssText =
    'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent =
    '.box{position:fixed;border:3px solid #13694f;background:#34b68722;box-sizing:border-box}.hint{position:fixed;top:12px;left:12px;max-width:420px;background:#16302a;color:white;padding:12px 16px;border-radius:12px;font:14px/1.5 system-ui;box-shadow:0 4px 20px #0004}';
  const box = document.createElement('div');
  box.className = 'box';
  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.setAttribute('role', 'status');
  hint.textContent =
    'Page Monitor · Point at text and click. ↑ parent · ↓ child · Enter select · Esc cancel';
  shadow.append(style, box, hint);
  document.documentElement.append(host);
  let selected: HTMLElement | null =
    document.activeElement instanceof HTMLElement &&
    document.activeElement !== document.body
      ? document.activeElement
      : null;
  const removers: Array<() => void> = [];
  const documents = new Set<Document>();
  const roots = new Set<Document | ShadowRoot>();
  const frames = new Set<HTMLIFrameElement>();
  const isHtml = (value: unknown): value is HTMLElement =>
    !!value &&
    typeof value === 'object' &&
    'nodeType' in value &&
    value.nodeType === 1 &&
    'namespaceURI' in value &&
    value.namespaceURI === 'http://www.w3.org/1999/xhtml';
  const targetOf = (event: Event): HTMLElement | null => {
    const target = event.composedPath().find(isHtml);
    return target && target !== host && !host.contains(target) ? target : null;
  };
  let submitting = false;
  const draw = () => {
    if (!selected?.isConnected) {
      box.style.display = 'none';
      return;
    }
    const r = selected.getBoundingClientRect();
    let left = r.left,
      top = r.top,
      width = r.width,
      height = r.height;
    let owner = selected.ownerDocument;
    while (owner !== document) {
      const frame = owner.defaultView?.frameElement;
      if (!isHtml(frame)) {
        box.style.display = 'none';
        return;
      }
      const bounds = frame.getBoundingClientRect();
      const sx = frame.offsetWidth ? bounds.width / frame.offsetWidth : 1;
      const sy = frame.offsetHeight ? bounds.height / frame.offsetHeight : 1;
      left = bounds.left + (left + frame.clientLeft) * sx;
      top = bounds.top + (top + frame.clientTop) * sy;
      width *= sx;
      height *= sy;
      owner = frame.ownerDocument;
    }
    box.style.cssText = `left:${left}px;top:${top}px;width:${width}px;height:${height}px`;
  };
  const cleanup = () => {
    clearTimeout(timeout);
    removers.forEach((remove) => remove());
    documents.clear();
    roots.clear();
    frames.clear();
    host.remove();
  };
  const send = async (payload: object, cancelled = false) => {
    if (cancelled) {
      cleanup();
      void chrome.runtime
        .sendMessage({ type: 'picked', token, ...payload })
        .catch(() => {});
      return;
    }
    if (submitting) return;
    submitting = true;
    hint.textContent = 'Sending selection…';
    try {
      const reply: unknown = await chrome.runtime.sendMessage({
        type: 'picked',
        token,
        ...payload,
      });
      if (
        !reply ||
        typeof reply !== 'object' ||
        !('ok' in reply) ||
        reply.ok !== true
      ) {
        const reason =
          reply &&
          typeof reply === 'object' &&
          'error' in reply &&
          typeof reply.error === 'string'
            ? reply.error
            : 'The extension did not acknowledge the selection.';
        throw new Error(reason);
      }
      cleanup();
    } catch (error) {
      hint.textContent = `Could not select this region: ${error instanceof Error ? error.message : 'Connection lost.'} Start the picker again from the side panel, or press Escape to cancel.`;
    } finally {
      submitting = false;
    }
  };
  const select = () => {
    if (!selected?.isConnected) {
      hint.textContent =
        'The page changed. Point at a region again, or press ↓ to start at the page body.';
      return;
    }
    if (
      ['INPUT', 'TEXTAREA', 'SELECT', 'SCRIPT', 'STYLE', 'NOSCRIPT'].includes(
        selected.tagName,
      ) ||
      selected.isContentEditable
    ) {
      hint.textContent = 'Choose page text, not an editable field.';
      return;
    }
    type Step = { css: string; via?: 'shadow' | 'frame' };
    function path(element: HTMLElement, depth = 0): Step[] {
      if (depth >= 8) throw new Error('Selection is nested too deeply.');
      const root = element.getRootNode();
      if (root.nodeType !== 9 && !(root.nodeType === 11 && 'host' in root))
        throw new Error('Region is unavailable.');
      const scope = root as Document | ShadowRoot;
      let css = '';
      let node: HTMLElement | null = element;
      while (node) {
        const candidates: string[] = [];
        if (node.id && !/^phx-|\d{6}/.test(node.id))
          candidates.push('#' + CSS.escape(node.id));
        for (const attribute of ['data-testid', 'data-test']) {
          const value = node.getAttribute(attribute);
          if (value) candidates.push(`[${attribute}="${CSS.escape(value)}"]`);
        }
        const unique = candidates.find(
          (candidate) => scope.querySelectorAll(candidate).length === 1,
        );
        if (unique) {
          css = unique + (css ? ' > ' + css : '');
          break;
        }
        const siblings = Array.from(node.parentNode?.children ?? []).filter(
          (e) => e.tagName === node?.tagName,
        );
        const part =
          node.tagName.toLowerCase() +
          (siblings.length > 1
            ? `:nth-of-type(${siblings.indexOf(node) + 1})`
            : '');
        css = part + (css ? ' > ' + css : '');
        node = node.parentElement;
      }
      const matches = scope.querySelectorAll(css);
      if (matches.length !== 1 || matches[0] !== element)
        throw new Error('Choose a smaller region.');
      if ('host' in scope) {
        if (!isHtml(scope.host)) throw new Error('Unsupported component.');
        const parent = path(scope.host, depth + 1);
        parent[parent.length - 1].via = 'shadow';
        return [...parent, { css }];
      }
      if (scope !== document) {
        const frame = scope.defaultView?.frameElement;
        if (!isHtml(frame))
          throw new Error('Only same-origin frames are supported.');
        const parent = path(frame, depth + 1);
        parent[parent.length - 1].via = 'frame';
        return [...parent, { css }];
      }
      return [{ css }];
    }
    let selector: string;
    try {
      const steps = path(selected);
      selector =
        steps.length === 1
          ? steps[0].css
          : '@page-monitor:' + JSON.stringify(steps);
    } catch (error) {
      hint.textContent =
        error instanceof Error ? error.message : 'Reselect the region.';
      return;
    }
    const copy = selected.cloneNode(true) as HTMLElement;
    copy
      .querySelectorAll(
        'script,style,noscript,input,textarea,select,[contenteditable],[hidden],[aria-hidden="true"],[data-page-monitor-overlay]',
      )
      .forEach((n) => n.remove());
    const sample = (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!sample || sample.length > 8000 || selector.length > 2000) {
      hint.textContent = 'Select a smaller, nonempty text region.';
      return;
    }
    void send({ selector, sample, title: document.title });
  };
  function move(event: PointerEvent) {
    const target = targetOf(event);
    if (target) {
      selected = target;
      draw();
    }
  }
  function click(event: MouseEvent) {
    event.preventDefault();
    event.stopImmediatePropagation();
    const target = targetOf(event);
    if (target && target !== host && !host.contains(target)) {
      selected = target;
      draw();
    }
    select();
  }
  function key(event: KeyboardEvent) {
    if (!['Escape', 'Enter', 'ArrowUp', 'ArrowDown'].includes(event.key))
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.key === 'Escape') void send({ cancelled: true }, true);
    else if (event.key === 'Enter') select();
    else {
      const candidate =
        event.key === 'ArrowUp'
          ? (selected?.parentElement ??
            (selected?.getRootNode() as ShadowRoot | undefined)?.host)
          : (selected?.shadowRoot?.firstElementChild ??
            selected?.firstElementChild ??
            document.body);
      if (isHtml(candidate) && candidate !== host) {
        selected = candidate;
        draw();
      }
    }
  }
  host.addEventListener('page-monitor-cleanup', cleanup, { once: true });
  function attach(doc: Document) {
    if (documents.has(doc) || documents.size >= 32) return;
    documents.add(doc);
    doc.addEventListener('pointermove', move, true);
    doc.addEventListener('click', click, true);
    doc.addEventListener('keydown', key, true);
    doc.addEventListener('scroll', draw, true);
    removers.push(() => {
      doc.removeEventListener('pointermove', move, true);
      doc.removeEventListener('click', click, true);
      doc.removeEventListener('keydown', key, true);
      doc.removeEventListener('scroll', draw, true);
    });
    watch(doc);
  }
  function scan(element: Element) {
    if (element === host) return;
    if (element.shadowRoot) watch(element.shadowRoot);
    if (element.tagName === 'IFRAME' || element.tagName === 'FRAME') {
      const frame = element as HTMLIFrameElement;
      if (frames.has(frame) || frames.size >= 32) return;
      frames.add(frame);
      const load = () => {
        try {
          const child = frame.contentDocument;
          if (child?.defaultView && child.defaultView.origin === window.origin)
            attach(child);
        } catch {
          /* Cross-origin or sandboxed frames are inaccessible. */
        }
      };
      frame.addEventListener('load', load);
      removers.push(() => frame.removeEventListener('load', load));
      load();
    }
  }
  function watch(root: Document | ShadowRoot) {
    if (roots.has(root) || roots.size >= 128) return;
    roots.add(root);
    root.querySelectorAll('*').forEach(scan);
    const observer = new MutationObserver((records) => {
      for (const record of records)
        for (const added of record.addedNodes) {
          if (added.nodeType !== 1) continue;
          const element = added as Element;
          scan(element);
          element.querySelectorAll('*').forEach(scan);
        }
    });
    observer.observe(root, { childList: true, subtree: true });
    removers.push(() => observer.disconnect());
  }
  attach(document);
  const timeout = setTimeout(() => {
    void send({ cancelled: true }, true);
  }, 120000);
  draw();
}
