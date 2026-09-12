import { extractRegion } from '../content/extract';
import { api } from './api';

export const browserName = 'Firefox';

export async function initializePlatform(): Promise<void> {
  // Firefox session storage is trusted-context-only by default. It has no
  // setAccessLevel API; local storage remains accessible to our content scripts.
}

export function registerToolbar(report: (error: unknown) => void): void {
  api().action.onClicked.addListener(() => {
    // Must be called synchronously in the user gesture, before any awaits.
    void browser.sidebarAction.open().catch(report);
  });
}

export async function notificationsAllowed(): Promise<boolean> {
  // Firefox has no getPermissionLevel. notifications.create rejection is the
  // delivery failure boundary; OS quiet modes can suppress successful requests.
  return true;
}

export function notificationContext(_hostname: string): object {
  void _hostname;
  return {};
}

export async function parseHTML(
  html: string,
  selector: string,
): Promise<unknown> {
  // The Firefox event page has a DOM. Keep fetched markup inert: never insert
  // it into the background page and never execute its scripts.
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  return extractRegion(selector, undefined, parsed);
}

export function supportedTab(
  tab: { incognito?: boolean; cookieStoreId?: string } | undefined,
): boolean {
  return !!tab && !tab.incognito && tab.cookieStoreId === 'firefox-default';
}

export function permissionPattern(url: URL): string {
  return `${url.protocol}//${url.hostname}` + '/*';
}
