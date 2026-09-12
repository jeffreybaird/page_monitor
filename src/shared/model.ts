export const MAX_TEXT = 8000;
export const MAX_MONITORS = 20;
export const MAX_HISTORY = 10;
export type Change = {
  id: string;
  at: number;
  before: string;
  after: string;
  delivered: boolean;
};
export type Monitor = {
  id: string;
  name: string;
  url: string;
  selector: string;
  intervalSeconds: number;
  durationMinutes: number | null;
  endsAt: number | null;
  enabled: boolean;
  snapshot: string | null;
  lastCheckAt: number | null;
  lastChangeAt: number | null;
  error: string | null;
  source: 'tab' | 'background' | 'rendered' | null;
  renderJavaScript?: boolean;
  renderingRequired?: boolean;
  renderingNotified?: boolean;
  history: Change[];
  unread: number;
};
export type State = { version: 1; monitors: Monitor[] };
export type Draft = {
  url: string;
  selector: string;
  sample: string;
  title: string;
};
export type MonitorInput = Pick<
  Monitor,
  | 'name'
  | 'url'
  | 'selector'
  | 'intervalSeconds'
  | 'durationMinutes'
  | 'renderJavaScript'
>;
export type Request =
  | { type: 'list' }
  | { type: 'clear-draft'; expected?: string }
  | { type: 'pick'; tabId: number; url: string }
  | {
      type: 'test-selector';
      url: string;
      selector: string;
      renderJavaScript?: boolean;
    }
  | { type: 'create'; input: MonitorInput }
  | { type: 'update'; id: string; input: MonitorInput }
  | { type: 'check' | 'delete' | 'read'; id: string }
  | { type: 'toggle'; id: string; enabled: boolean };
export type View = {
  monitors: Monitor[];
  draft: Draft | null;
  checkingId?: string | null;
  preview?: {
    url: string;
    selector: string;
    text: string;
    source: 'tab' | 'background' | 'rendered';
  };
};
export type Reply = { ok: true; value: View } | { ok: false; error: string };
export function webUrl(value: string): string {
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    value.length > 2048
  )
    throw new Error('Use an HTTP or HTTPS URL without embedded credentials.');
  return url.href;
}
export function originPattern(url: string): string {
  return `${new URL(webUrl(url)).origin}/*`;
}
export function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
export function inputValid(input: unknown): input is MonitorInput {
  if (!input || typeof input !== 'object') return false;
  const i = input as Record<string, unknown>;
  try {
    if (typeof i.url !== 'string') return false;
    webUrl(i.url);
  } catch {
    return false;
  }
  return (
    (i.renderJavaScript === undefined ||
      typeof i.renderJavaScript === 'boolean') &&
    typeof i.name === 'string' &&
    i.name.trim().length > 0 &&
    i.name.length <= 100 &&
    typeof i.selector === 'string' &&
    i.selector.length > 0 &&
    i.selector.length <= 2000 &&
    typeof i.intervalSeconds === 'number' &&
    Number.isInteger(i.intervalSeconds) &&
    i.intervalSeconds >= 30 &&
    i.intervalSeconds <= 86400 &&
    (i.durationMinutes === null ||
      (typeof i.durationMinutes === 'number' &&
        Number.isInteger(i.durationMinutes) &&
        i.durationMinutes >= 1 &&
        i.durationMinutes <= 525600))
  );
}
export function requestValid(value: unknown): value is Request {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  if (r.type === 'list') return true;
  if (r.type === 'clear-draft')
    return (
      r.expected === undefined ||
      (typeof r.expected === 'string' && r.expected.length <= 65536)
    );
  if (r.type === 'pick') {
    try {
      return (
        Number.isInteger(r.tabId) &&
        typeof r.tabId === 'number' &&
        r.tabId >= 0 &&
        typeof r.url === 'string' &&
        !!webUrl(r.url)
      );
    } catch {
      return false;
    }
  }
  if (r.type === 'test-selector') {
    try {
      return (
        (r.renderJavaScript === undefined ||
          typeof r.renderJavaScript === 'boolean') &&
        typeof r.url === 'string' &&
        !!webUrl(r.url) &&
        typeof r.selector === 'string' &&
        r.selector.trim().length > 0 &&
        r.selector.length <= 2000
      );
    } catch {
      return false;
    }
  }
  if (r.type === 'create') return inputValid(r.input);
  if (typeof r.id !== 'string' || r.id.length > 100) return false;
  if (r.type === 'update') return inputValid(r.input);
  return (
    ['check', 'delete', 'read'].includes(String(r.type)) ||
    (r.type === 'toggle' && typeof r.enabled === 'boolean')
  );
}
export function applySnapshot(
  m: Monitor,
  text: string,
  now: number,
  eventId: string,
): Monitor {
  const next = normalize(text);
  if (!next)
    throw new Error(
      'Selected region is empty. Check your session or reselect the region.',
    );
  if (next.length > MAX_TEXT)
    throw new Error('Selected region is too large. Select a smaller region.');
  const changed = m.snapshot !== null && m.snapshot !== next;
  return {
    ...m,
    snapshot: next,
    lastCheckAt: now,
    error: null,
    lastChangeAt: changed ? now : m.lastChangeAt,
    unread: changed ? m.unread + 1 : m.unread,
    history: changed
      ? [
          {
            id: eventId,
            at: now,
            before: m.snapshot ?? '',
            after: next,
            delivered: false,
          },
          ...m.history,
        ].slice(0, MAX_HISTORY)
      : m.history,
  };
}
