import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readEditorDraft,
  saveEditorDraft,
  type EditorDraft,
} from '../../src/sidepanel/editor-draft';

const partial: EditorDraft = {
  editingId: null,
  name: 'My work',
  url: 'https://',
  selector: '[data-',
  interval: '',
  units: '60',
  durationMode: 'duration',
  duration: '',
  renderJavaScript: true,
};
let data: Record<string, unknown>;
const set = vi.fn(async (values: Record<string, unknown>) => {
  Object.assign(data, structuredClone(values));
});
const remove = vi.fn(async (key: string) => {
  delete data[key];
});
const get = vi.fn(async (key: string) => ({ [key]: data[key] }));

beforeEach(() => {
  data = {};
  vi.clearAllMocks();
  vi.stubGlobal('chrome', { storage: { session: { set, remove, get } } });
});
afterEach(() => vi.unstubAllGlobals());

describe('session editor drafts', () => {
  it('restores partial input without storing extra page data', async () => {
    await saveEditorDraft(1, {
      ...partial,
      sample: 'Private content',
    } as EditorDraft);
    expect(await readEditorDraft(1)).toEqual(partial);
    expect(data['editorDraft:1']).not.toHaveProperty('sample');
  });

  it('keeps windows independent and clears only the requested draft', async () => {
    await saveEditorDraft(1, partial);
    await saveEditorDraft(2, {
      ...partial,
      name: 'Other window',
      editingId: 'id',
    });
    await saveEditorDraft(1, null);
    expect(await readEditorDraft(1)).toBeNull();
    expect(await readEditorDraft(2)).toMatchObject({
      name: 'Other window',
      editingId: 'id',
    });
  });

  it.each([
    null,
    [],
    { ...partial, units: 60 },
    { ...partial, units: '7' },
    { ...partial, durationMode: 'once' },
    { ...partial, renderJavaScript: 'true' },
    { ...partial, name: 'x'.repeat(101) },
    { ...partial, selector: 'x'.repeat(2001) },
    { ...partial, interval: 'x'.repeat(33) },
    { ...partial, url: 'https://user:password@example.com' },
  ])('ignores malformed stored data %#', async (value) => {
    data['editorDraft:1'] = value;
    expect(await readEditorDraft(1)).toBeNull();
  });

  it.each([
    'https://me:secret@example.com',
    'https://me:secret@',
    '//me:secret@example.com',
  ])('rejects credential-bearing URLs without persisting them', async (url) => {
    await expect(saveEditorDraft(1, { ...partial, url })).rejects.toThrow(
      'username or password',
    );
    expect(set).not.toHaveBeenCalled();
  });

  it('serializes pending writes before a final clear', async () => {
    let release: () => void = () => {};
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    set.mockImplementationOnce(async (values) => {
      await waiting;
      Object.assign(data, values);
    });
    const first = saveEditorDraft(1, partial);
    const second = saveEditorDraft(1, { ...partial, name: 'Latest' });
    const clear = saveEditorDraft(1, null);
    await Promise.resolve();
    expect(remove).not.toHaveBeenCalled();
    release();
    await Promise.all([first, second, clear]);
    expect(await readEditorDraft(1)).toBeNull();
  });

  it('reports storage failures and allows subsequent operations', async () => {
    set.mockRejectedValueOnce(new Error('Quota exceeded'));
    await expect(saveEditorDraft(1, partial)).rejects.toThrow('Quota exceeded');
    await saveEditorDraft(1, partial);
    remove.mockRejectedValueOnce(new Error('Storage unavailable'));
    await expect(saveEditorDraft(1, null)).rejects.toThrow(
      'Storage unavailable',
    );
    expect(await readEditorDraft(1)).toEqual(partial);
    await saveEditorDraft(1, null);
    get.mockRejectedValueOnce(new Error('Read failed'));
    await expect(readEditorDraft(1)).rejects.toThrow('Read failed');
  });
});
