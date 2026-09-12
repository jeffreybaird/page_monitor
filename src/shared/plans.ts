import type { Monitor } from './model';

export const LIFETIME_PRICE = '$2.99';
export const FREE_ACTIVE_MONITORS = 3;
export const FREE_INTERVAL_SECONDS = 300;

export function isActive(monitor: Monitor, now: number): boolean {
  return monitor.enabled && (monitor.endsAt === null || monitor.endsAt > now);
}

/** Check the proposed settings, excluding the monitor being edited/resumed. */
export function paidFeatureReason(
  monitors: Monitor[],
  intervalSeconds: number,
  active: boolean,
  id?: string,
  now = Date.now(),
): string | null {
  if (intervalSeconds < FREE_INTERVAL_SECONDS)
    return 'Checks faster than 5 minutes require a $2.99 lifetime license.';
  if (
    active &&
    monitors.filter((m) => m.id !== id && isActive(m, now)).length >=
      FREE_ACTIVE_MONITORS
  )
    return 'More than 3 active monitors requires a $2.99 lifetime license. Pause another monitor or upgrade.';
  return null;
}
