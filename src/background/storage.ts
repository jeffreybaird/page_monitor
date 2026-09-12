import {
  inputValid,
  MAX_HISTORY,
  MAX_MONITORS,
  MAX_TEXT,
  type State,
} from '../shared/model';
export const STATE_KEY = 'pageMonitor';
function finiteNullable(x: unknown): boolean {
  return x === null || (typeof x === 'number' && Number.isFinite(x));
}
export function validateState(value: unknown): State {
  if (value === undefined) return { version: 1, monitors: [] };
  if (!value || typeof value !== 'object')
    throw new Error(
      'Saved monitor data is invalid. Export or clear extension data before continuing.',
    );
  const s = value as State;
  if (
    s.version !== 1 ||
    !Array.isArray(s.monitors) ||
    s.monitors.length > MAX_MONITORS
  )
    throw new Error('Unsupported saved monitor data. It has been preserved.');
  const ids = new Set<string>();
  for (const m of s.monitors) {
    if (
      !inputValid(m) ||
      typeof m.id !== 'string' ||
      !m.id ||
      m.id.length > 100 ||
      ids.has(m.id) ||
      typeof m.enabled !== 'boolean' ||
      !finiteNullable(m.endsAt) ||
      !finiteNullable(m.lastCheckAt) ||
      !finiteNullable(m.lastChangeAt) ||
      !(
        m.snapshot === null ||
        (typeof m.snapshot === 'string' && m.snapshot.length <= MAX_TEXT)
      ) ||
      !(m.error === null || typeof m.error === 'string') ||
      ![null, 'tab', 'background', 'rendered'].includes(m.source) ||
      ![undefined, true, false].includes(m.renderingRequired) ||
      ![undefined, true, false].includes(m.renderingNotified) ||
      !Number.isSafeInteger(m.unread) ||
      m.unread < 0 ||
      !Array.isArray(m.history) ||
      m.history.length > MAX_HISTORY
    )
      throw new Error('Saved monitor data is invalid. It has been preserved.');
    ids.add(m.id);
    for (const h of m.history)
      if (
        !h ||
        typeof h.id !== 'string' ||
        typeof h.at !== 'number' ||
        !Number.isFinite(h.at) ||
        typeof h.before !== 'string' ||
        h.before.length > MAX_TEXT ||
        typeof h.after !== 'string' ||
        h.after.length > MAX_TEXT ||
        typeof h.delivered !== 'boolean'
      )
        throw new Error('Saved history is invalid. It has been preserved.');
  }
  return s;
}
export async function readState(): Promise<State> {
  return validateState((await chrome.storage.local.get(STATE_KEY))[STATE_KEY]);
}
export async function writeState(state: State): Promise<void> {
  validateState(state);
  await chrome.storage.local.set({ [STATE_KEY]: state });
}
