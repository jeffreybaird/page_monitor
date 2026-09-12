export type EditorDraft = {
  editingId: string | null;
  name: string;
  url: string;
  selector: string;
  interval: string;
  units: string;
  durationMode: string;
  duration: string;
  renderJavaScript: boolean;
};

const pending = new Map<number, Promise<void>>();

function key(windowId: number): string {
  if (!Number.isSafeInteger(windowId) || windowId < 0)
    throw new Error('Cannot save this editor without a browser window.');
  return `editorDraft:${windowId}`;
}

function hasCredentials(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) return true;
  } catch {
    // Partially typed URLs are valid drafts, including an incomplete authority.
  }
  return /^(?:[a-z][a-z\d+.-]*:)?[/\\]{2}[^/\\?#]*@/i.test(url.trim());
}

function parse(value: unknown): EditorDraft | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const bounded = (field: string, max: number): boolean =>
    typeof v[field] === 'string' && v[field].length <= max;
  if (
    !(v.editingId === null || bounded('editingId', 100)) ||
    !bounded('name', 100) ||
    !bounded('url', 2048) ||
    !bounded('selector', 2000) ||
    !bounded('interval', 32) ||
    !bounded('duration', 32) ||
    !['1', '60', '3600'].includes(String(v.units)) ||
    typeof v.units !== 'string' ||
    !['forever', 'duration'].includes(String(v.durationMode)) ||
    typeof v.durationMode !== 'string' ||
    typeof v.renderJavaScript !== 'boolean'
  )
    return null;
  const draft = v as EditorDraft;
  if (hasCredentials(draft.url)) return null;
  // Copy only editor fields: never retain a sample, snapshot, or unknown data.
  return {
    editingId: draft.editingId,
    name: draft.name,
    url: draft.url,
    selector: draft.selector,
    interval: draft.interval,
    units: draft.units,
    durationMode: draft.durationMode,
    duration: draft.duration,
    renderJavaScript: draft.renderJavaScript,
  };
}

export async function readEditorDraft(
  windowId: number,
): Promise<EditorDraft | null> {
  const storageKey = key(windowId);
  await pending.get(windowId);
  const values = await chrome.storage.session.get(storageKey);
  return parse(values[storageKey]);
}

export async function saveEditorDraft(
  windowId: number,
  draft: EditorDraft | null,
): Promise<void> {
  const storageKey = key(windowId);
  if (draft !== null && hasCredentials(draft.url))
    throw new Error(
      'Remove the username or password from the URL before saving this draft.',
    );
  const clean = draft === null ? null : parse(draft);
  if (draft !== null && clean === null)
    throw new Error('This editor draft contains invalid or oversized fields.');
  const write = (pending.get(windowId) ?? Promise.resolve()).then(async () => {
    if (clean === null) await chrome.storage.session.remove(storageKey);
    else await chrome.storage.session.set({ [storageKey]: clean });
  });
  // Each caller sees its own failure; a failed write must not block later clears.
  const settled = write.catch(() => {});
  pending.set(windowId, settled);
  try {
    await write;
  } finally {
    if (pending.get(windowId) === settled) pending.delete(windowId);
  }
}
