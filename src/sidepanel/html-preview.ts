import { extractRegion } from '../content/extract';

/** Parse inertly and sanitize again: stored page data is never trusted. */
export function htmlPreview(
  html: string | null | undefined,
  text: string,
): HTMLElement {
  const host = document.createElement('div');
  host.className = 'html-preview';
  host.tabIndex = 0;
  host.dataset.action = 'snapshot-preview';
  host.setAttribute('role', 'region');
  host.setAttribute('aria-label', 'HTML preview');
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
    :host { display:block; color:#202124; font:13px/1.5 system-ui,sans-serif; }
    * { box-sizing:border-box; }
    h1,h2,h3,h4,h5,h6 { line-height:1.3; margin:12px 0 8px; }
    h1 { font-size:22px; } h2 { font-size:19px; } h3 { font-size:16px; }
    p,ul,ol,dl,blockquote,pre { margin:8px 0; }
    ul,ol { padding-left:24px; } blockquote { border-left:3px solid #dadce0; padding-left:12px; }
    pre { white-space:pre-wrap; } code { font-family:monospace; }
    table { border-collapse:collapse; max-width:100%; }
    th,td { border:1px solid #dadce0; padding:6px 8px; text-align:left; }
    th { background:#f1f3f4; } :first-child { margin-top:0; }
  `;
  shadow.append(style);
  if (html && html.length <= 64000) {
    const template = document.createElement('template');
    // Template contents have no browsing context: scripts and resource loads stay inert.
    template.innerHTML = html;
    const inertDocument = template.content.ownerDocument;
    const wrapper = inertDocument.createElement('div');
    wrapper.id = `preview-${crypto.randomUUID()}`;
    wrapper.append(template.content);
    const fragment = inertDocument.createDocumentFragment();
    fragment.append(wrapper);
    const result = extractRegion(`#${wrapper.id}`, undefined, fragment);
    if ('html' in result && result.html) {
      const safe = document.createElement('template');
      safe.innerHTML = result.html;
      shadow.append(safe.content.cloneNode(true));
      return host;
    }
  }
  const fallback = document.createElement('p');
  fallback.textContent = text;
  shadow.append(fallback);
  return host;
}
