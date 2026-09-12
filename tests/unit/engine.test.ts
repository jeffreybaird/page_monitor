import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applySnapshot,
  type Monitor,
  requestValid,
} from '../../src/shared/model';
import { extractRegion } from '../../src/content/extract';
import {
  validateState,
  readState,
  writeState,
} from '../../src/background/storage';
import { deliver } from '../../src/background/notifiers';
const monitor = (): Monitor => ({
  id: 'm1',
  name: 'Price',
  url: 'https://example.com/',
  selector: '#price',
  intervalSeconds: 30,
  durationMinutes: null,
  endsAt: null,
  enabled: true,
  snapshot: null,
  lastCheckAt: null,
  lastChangeAt: null,
  error: null,
  source: null,
  history: [],
  unread: 0,
});
beforeEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
describe('comparison and retention', () => {
  it('baselines without alert, ignores whitespace, emits every subsequent change', () => {
    let m = applySnapshot(monitor(), '  $40 ', 1, 'one');
    expect(m.history).toEqual([]);
    m = applySnapshot(m, '$40\n', 2, 'two');
    expect(m.unread).toBe(0);
    m = applySnapshot(m, '$39', 3, 'three');
    m = applySnapshot(m, '$38', 4, 'four');
    expect(m.unread).toBe(2);
    expect(m.history.map((x) => x.id)).toEqual(['four', 'three']);
    expect(m.history[1].before).toBe('$40');
  });
  it('preserves the input on empty/oversized extraction and bounds history', () => {
    let m = applySnapshot(monitor(), 'start', 1, 'first');
    expect(() => applySnapshot(m, '', 2, 'bad')).toThrow();
    expect(m.snapshot).toBe('start');
    expect(() => applySnapshot(m, 'x'.repeat(8001), 3, 'bad')).toThrow();
    for (let i = 0; i < 15; i++)
      m = applySnapshot(m, String(i), i + 3, String(i));
    expect(m.history).toHaveLength(10);
  });
});
describe('untrusted extraction', () => {
  it('removes executable, hidden, and form content', () => {
    document.body.innerHTML =
      '<section id="price">$40<script>secret()</script><input value="private"><span hidden>private</span></section>';
    expect(extractRegion('#price')).toMatchObject({ text: '$40' });
  });
  it('refuses login, missing, ambiguous, and editable regions', () => {
    document.body.innerHTML =
      '<div class="price">1</div><div class="price">2</div>';
    expect(extractRegion('.price')).toHaveProperty('error');
    expect(extractRegion('#missing')).toHaveProperty('error');
    expect(extractRegion('[')).toHaveProperty('error');
    document.body.innerHTML =
      '<div id="price"><input type="password">Sign in</div>';
    expect(extractRegion('#price')).toHaveProperty('error');
  });
  it('parses inert fetched HTML using the same extraction policy', () => {
    const doc = new DOMParser().parseFromString(
      '<section id="price">$42<script>bad()</script></section>',
      'text/html',
    );
    expect(extractRegion('#price', undefined, doc)).toMatchObject({
      text: '$42',
    });
  });
});
describe('boundaries', () => {
  it('rejects unsafe schedules and malformed messages', () => {
    for (const intervalSeconds of [0, 5, 29, NaN, Infinity, 86401])
      expect(
        requestValid({
          type: 'create',
          input: { ...monitor(), intervalSeconds },
        }),
      ).toBe(false);
    expect(requestValid({ type: 'toggle', id: 'm1', enabled: 'yes' })).toBe(
      false,
    );
    expect(
      requestValid({
        type: 'create',
        input: { ...monitor(), durationMinutes: -1 },
      }),
    ).toBe(false);
  });
  it('validates rendering options and preserves existing monitor data', () => {
    expect(
      requestValid({
        type: 'create',
        input: { ...monitor(), renderJavaScript: 'yes' },
      }),
    ).toBe(false);
    expect(
      requestValid({
        type: 'test-selector',
        url: monitor().url,
        selector: '#price',
        renderJavaScript: 'yes',
      }),
    ).toBe(false);
    const existing = { version: 1, monitors: [monitor()] };
    expect(validateState(existing)).toEqual(existing);
    const rendered = {
      version: 1,
      monitors: [
        {
          ...monitor(),
          source: 'rendered',
          renderingRequired: true,
          renderingNotified: true,
        },
      ],
    };
    expect(validateState(rendered)).toEqual(rendered);
    expect(() =>
      validateState({
        version: 1,
        monitors: [{ ...monitor(), renderingNotified: 'yes' }],
      }),
    ).toThrow();
  });
  it('initializes missing storage and preserves invalid/future schemas', () => {
    expect(validateState(undefined)).toEqual({ version: 1, monitors: [] });
    expect(() => validateState({ version: 2, monitors: [] })).toThrow();
    expect(() =>
      validateState({
        version: 1,
        monitors: [{ ...monitor(), snapshot: 123 }],
      }),
    ).toThrow();
    expect(() =>
      validateState({ version: 1, monitors: [monitor(), monitor()] }),
    ).toThrow();
  });
  it('does not mask storage write failures', async () => {
    const set = vi.fn().mockRejectedValue(new Error('quota'));
    vi.stubGlobal('chrome', {
      storage: { local: { set, get: vi.fn().mockResolvedValue({}) } },
    });
    await expect(
      writeState({ version: 1, monitors: [monitor()] }),
    ).rejects.toThrow('quota');
    expect(await readState()).toEqual({ version: 1, monitors: [] });
  });
  it('supports notifier adapters and propagates delivery failure', async () => {
    const m = applySnapshot(
      { ...monitor(), snapshot: 'old' },
      'new',
      1,
      'event',
    );
    const notice = { monitor: m, change: m.history[0] };
    const send = vi.fn().mockResolvedValue(undefined);
    await deliver(notice, [{ id: 'fake', send }]);
    expect(send).toHaveBeenCalledWith(notice);
    await expect(
      deliver(notice, [
        {
          id: 'broken',
          send: async () => {
            throw new Error('disabled');
          },
        },
      ]),
    ).rejects.toThrow('disabled');
  });
});

describe('component selector paths', () => {
  const path = (steps: unknown) => '@page-monitor:' + JSON.stringify(steps);
  it('reads open shadow text and rejects inaccessible components in fetched HTML', () => {
    document.body.innerHTML = '<price-card id="card"></price-card>';
    const card = document.querySelector('#card');
    if (!card) throw new Error('Missing fixture');
    card.attachShadow({ mode: 'open' }).innerHTML =
      '<p id="value">42<input value="private"><span hidden>hidden</span></p>';
    const selector = path([{ css: '#card', via: 'shadow' }, { css: '#value' }]);
    expect(extractRegion(selector)).toMatchObject({ text: '42' });
    const inert = new DOMParser().parseFromString(
      '<price-card id="card"></price-card>',
      'text/html',
    );
    expect(extractRegion(selector, undefined, inert)).toEqual({
      error: expect.stringContaining('open tab'),
      renderable: true,
    });
  });
  it('rejects malformed, oversized, and excessive path steps', () => {
    for (const selector of [
      path(null),
      path([]),
      path([{}]),
      path([{ css: 'body', via: 'execute' }, { css: 'p' }]),
      path(Array.from({ length: 9 }, () => ({ css: 'body', via: 'shadow' }))),
      '@page-monitor:' + 'x'.repeat(2000),
    ]) {
      expect(extractRegion(selector)).toHaveProperty('error');
    }
  });
  it('does not traverse frames in inert background HTML', () => {
    const doc = new DOMParser().parseFromString(
      '<iframe id="frame" src="/frame"></iframe>',
      'text/html',
    );
    expect(
      extractRegion(
        path([{ css: '#frame', via: 'frame' }, { css: 'p' }]),
        undefined,
        doc,
      ),
    ).toEqual({
      error: expect.stringContaining('Keep the page open'),
      renderable: true,
    });
  });
});
