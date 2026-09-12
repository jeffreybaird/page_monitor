import { describe, expect, it } from 'vitest';
import { extractRegion } from '../../src/content/extract';
import { htmlPreview } from '../../src/sidepanel/html-preview';

function extract(html: string) {
  const doc = new DOMParser().parseFromString(
    `<section id="region">${html}</section>`,
    'text/html',
  );
  return extractRegion('#region', undefined, doc);
}

describe('HTML snapshots', () => {
  it('preserves headings, emphasis, lists, and table structure without source styling', () => {
    const result = extract(
      '<h2 style="position:fixed">Stock</h2><p><strong>Ready</strong></p><ul><li>Blue</li></ul><table><tr><td colspan="2">42</td></tr></table>',
    );
    expect(result).toMatchObject({ text: 'StockReadyBlue42' });
    expect('html' in result && result.html).toContain('<h2>Stock</h2>');
    const preview = htmlPreview(
      'html' in result ? result.html : null,
      'fallback',
    );
    expect(preview.shadowRoot?.querySelector('strong')?.textContent).toBe(
      'Ready',
    );
    expect(preview.shadowRoot?.querySelector('li')?.textContent).toBe('Blue');
    expect(
      preview.shadowRoot?.querySelector('td')?.getAttribute('colspan'),
    ).toBe('2');
  });

  it('re-sanitizes stored HTML and removes executable, interactive, and network content', () => {
    const preview = htmlPreview(
      `<p id="app" onclick="alert(1)" style="background:url(https://evil.test)"><strong>Safe</strong><a href="javascript:alert(1)">link</a><img src="https://evil.test" onerror="alert(1)" alt="Photo"><iframe src="https://evil.test"></iframe><script>alert(1)</script><svg onload="alert(1)"><text>SVG</text></svg><form><input value="secret"></form><meta http-equiv="refresh" content="0;url=https://evil.test"><style>@import 'https://evil.test';</style></p>`,
      'fallback',
    );
    const root = preview.shadowRoot!;
    expect(root.querySelector('strong')?.textContent).toBe('Safe');
    expect(
      root.querySelector(
        'script,img,iframe,svg,form,input,meta,link,a,[id],[style],[onclick],[onerror]',
      ),
    ).toBeNull();
    expect(root.querySelectorAll('style')).toHaveLength(1); // Only the packaged preview stylesheet.
    expect(root.textContent).toContain('SafelinkPhoto');
    expect(root.textContent).not.toContain('secret');
  });

  it('falls back to literal text for older snapshots, invalid HTML and excessive markup', () => {
    for (const html of [
      undefined,
      '<script>alert(1)</script>',
      'x'.repeat(64001),
    ]) {
      const preview = htmlPreview(html, '<b>literal</b>');
      expect(preview.shadowRoot?.querySelector('p')?.textContent).toBe(
        '<b>literal</b>',
      );
      expect(preview.shadowRoot?.querySelector('b')).toBeNull();
    }
  });

  it('retains text when markup exceeds node or depth limits', () => {
    const result = extract('<span>x</span>'.repeat(2100));
    expect(result).toMatchObject({ text: 'x'.repeat(2100) });
    expect(result).not.toHaveProperty('html');
    expect(extract('<div>'.repeat(45) + 'x' + '</div>'.repeat(45))).toEqual({
      text: 'x',
    });
  });
});
