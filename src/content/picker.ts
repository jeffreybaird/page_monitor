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
  let submitting = false;
  const draw = () => {
    if (!selected?.isConnected) {
      box.style.display = 'none';
      return;
    }
    const r = selected.getBoundingClientRect();
    box.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
  };
  const cleanup = () => {
    clearTimeout(timeout);
    document.removeEventListener('pointermove', move, true);
    document.removeEventListener('click', click, true);
    document.removeEventListener('keydown', key, true);
    window.removeEventListener('scroll', draw, true);
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
    let selector = '';
    let node: HTMLElement | null = selected;
    while (node && node !== document.documentElement) {
      if (node.id && !/^phx-|\d{6}/.test(node.id)) {
        const id = '#' + CSS.escape(node.id);
        if (document.querySelectorAll(id).length === 1) {
          selector = id + (selector ? ' > ' + selector : '');
          break;
        }
      }
      const tag = node.tagName.toLowerCase();
      const siblings = node.parentElement
        ? Array.from(node.parentElement.children).filter(
            (e) => e.tagName === node?.tagName,
          )
        : [];
      const part =
        tag +
        (siblings.length > 1
          ? `:nth-of-type(${siblings.indexOf(node) + 1})`
          : '');
      selector = part + (selector ? ' > ' + selector : '');
      node = node.parentElement;
    }
    const matches = selector ? document.querySelectorAll(selector) : [];
    if (matches.length !== 1 || matches[0] !== selected) {
      hint.textContent =
        'This region cannot be selected reliably. Choose a smaller region.';
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
    const target = event.target;
    if (target instanceof HTMLElement && target !== host) {
      selected = target;
      draw();
    }
  }
  function click(event: MouseEvent) {
    event.preventDefault();
    event.stopImmediatePropagation();
    const target =
      event.target instanceof HTMLElement
        ? event.target
        : event.target instanceof Element
          ? event.target.parentElement
          : null;
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
          ? selected?.parentElement
          : (selected?.firstElementChild ?? document.body);
      if (candidate instanceof HTMLElement && candidate !== host) {
        selected = candidate;
        draw();
      }
    }
  }
  host.addEventListener('page-monitor-cleanup', cleanup, { once: true });
  document.addEventListener('pointermove', move, true);
  document.addEventListener('click', click, true);
  document.addEventListener('keydown', key, true);
  window.addEventListener('scroll', draw, true);
  const timeout = setTimeout(() => {
    void send({ cancelled: true }, true);
  }, 120000);
  draw();
}
