import type { Change, Monitor } from '../shared/model';
export type ChangeNotice = { monitor: Monitor; change: Change };
export type Notifier = {
  id: string;
  send: (notice: ChangeNotice) => Promise<void>;
};
export const desktopNotifier: Notifier = {
  id: 'desktop',
  async send({ monitor, change }) {
    const permission = await chrome.notifications.getPermissionLevel();
    if (permission !== 'granted')
      throw new Error(
        'Desktop notifications are disabled. Allow them in Chrome/system settings.',
      );
    await chrome.notifications.create(`change:${monitor.id}:${change.id}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/128.png'),
      title: `${monitor.name} changed`,
      message: `${change.before.slice(0, 100)} → ${change.after.slice(0, 140)}`,
      contextMessage: new URL(monitor.url).hostname,
    });
  },
};
// Add a channel here. A channel must reject failures and accept a stable change ID.
export const notifiers: Notifier[] = [desktopNotifier];
export async function deliver(
  notice: ChangeNotice,
  channels: Notifier[] = notifiers,
): Promise<void> {
  for (const channel of channels) await channel.send(notice);
}
export async function updateBadge(monitors: Monitor[]): Promise<void> {
  const count = monitors.reduce((sum, m) => sum + m.unread, 0);
  await chrome.action.setBadgeText({
    text: count ? (count > 99 ? '99+' : String(count)) : '',
  });
  await chrome.action.setBadgeBackgroundColor({ color: '#185b46' });
}
