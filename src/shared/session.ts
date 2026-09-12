import { webUrl, type Draft } from './model';
export function draftValue(value: unknown): Draft | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v.url !== 'string' ||
    typeof v.selector !== 'string' ||
    typeof v.sample !== 'string' ||
    typeof v.title !== 'string' ||
    v.selector.length > 2000 ||
    v.sample.length > 8000 ||
    v.title.length > 100
  )
    return null;
  try {
    webUrl(v.url);
  } catch {
    return null;
  }
  return { url: v.url, selector: v.selector, sample: v.sample, title: v.title };
}
export function pendingValue(
  value: unknown,
): { token: string; tabId: number; url: string; expiresAt: number } | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v.token !== 'string' ||
    typeof v.tabId !== 'number' ||
    typeof v.url !== 'string' ||
    typeof v.expiresAt !== 'number'
  )
    return null;
  return { token: v.token, tabId: v.tabId, url: v.url, expiresAt: v.expiresAt };
}
