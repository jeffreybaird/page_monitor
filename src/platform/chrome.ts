import { api } from './api';

export const browserName = 'Chrome';

export async function initializePlatform(): Promise<void> {
  await api().storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  await api().storage.session.setAccessLevel({
    accessLevel: 'TRUSTED_CONTEXTS',
  });
  await api().sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
}

// Chrome opens its panel through setPanelBehavior, without a click listener.
export function registerToolbar(_report: (error: unknown) => void): void {
  void _report;
}

export async function notificationsAllowed(): Promise<boolean> {
  return (await api().notifications.getPermissionLevel()) === 'granted';
}

export function notificationContext(hostname: string): {
  contextMessage: string;
} {
  return { contextMessage: hostname };
}

export async function parseHTML(
  html: string,
  selector: string,
): Promise<unknown> {
  if (!(await api().offscreen.hasDocument()))
    await api().offscreen.createDocument({
      url: 'offscreen.html',
      reasons: [api().offscreen.Reason.DOM_PARSER],
      justification:
        'Extract the selected text from HTML fetched using the browser session.',
    });
  try {
    return await api().runtime.sendMessage({ type: 'parse', html, selector });
  } finally {
    await api().offscreen.closeDocument();
  }
}

export function supportedTab(
  tab: { incognito?: boolean } | undefined,
): boolean {
  return !!tab && !tab.incognito;
}

export function permissionPattern(url: URL): string {
  return url.origin + '/*';
}
