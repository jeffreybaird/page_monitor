import {
  paidFeatureReason,
  FREE_ACTIVE_MONITORS,
  FREE_INTERVAL_SECONDS,
  isActive,
} from '../shared/plans';
import {
  license,
  refreshLicense,
  openPurchase,
  initializePayments,
  settleLicenseAlarm,
  LICENSE_ALARM,
} from './payments';
import { initializePlatform, registerToolbar, supportedTab } from '#platform';
import { api } from '../platform/api';
import { draftValue, pendingValue } from '../shared/session';
import { startPicker } from '../content/picker';
import {
  applySnapshot,
  MAX_MONITORS,
  originPattern,
  requestValid,
  webUrl,
  type Draft,
  type Monitor,
  type Request,
  type View,
} from '../shared/model';
import { readState, writeState } from './storage';
import { readRegion } from './reader';
import {
  cleanupRenderingTabs,
  releaseRenderingTab,
  RENDER_CLEANUP_ALARM,
} from './renderer';
import { deliver, updateBadge, notifyRendering } from './notifiers';
const PREFIX = 'monitor:';
const NOTIFY_ALARM = 'pending-notifications';
// Single worker owns all read/modify/write operations. Persisted state is authoritative.
let tail: Promise<unknown> = Promise.resolve();
let checkingId: string | null = null;
const requestedChecks = new Set<string>();
let draftTail: Promise<unknown> = Promise.resolve();
function draftSerial<T>(work: () => Promise<T>): Promise<T> {
  const task = draftTail.then(work);
  draftTail = task.catch(() => {});
  return task;
}
function serial<T>(work: () => Promise<T>): Promise<T> {
  const task = tail.then(work);
  tail = task.catch(() => {});
  return task;
}
function errorText(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'The operation failed. Please try again.';
}
async function view(): Promise<View> {
  return {
    monitors: (await readState()).monitors,
    license: await license(),
    checkingId,
    draft: draftValue((await api().storage.session.get('draft')).draft),
  };
}
async function syncAlarm(m: Monitor): Promise<void> {
  const name = PREFIX + m.id;
  if (!m.enabled) {
    await api().alarms.clear(name);
    return;
  }
  const next = Math.min(
    Date.now() + m.intervalSeconds * 1000,
    m.endsAt ?? Infinity,
  );
  await api().alarms.create(name, {
    when: next,
    periodInMinutes: m.intervalSeconds / 60,
  });
}
/** Pause restricted monitors without changing their saved settings or history. */
async function enforcePlan(): Promise<void> {
  if ((await license()).paid) return;
  const state = await readState();
  let active = 0;
  let changed = false;
  for (const m of state.monitors) {
    if (!isActive(m, Date.now())) continue;
    const restricted =
      m.intervalSeconds < FREE_INTERVAL_SECONDS ||
      active >= FREE_ACTIVE_MONITORS;
    if (restricted) {
      m.enabled = false;
      m.error =
        'Paused: a $2.99 lifetime license is required. Upgrade or edit settings to use the free plan, then resume.';
      changed = true;
    } else active++;
  }
  if (changed) await writeState(state);
  // Retry clearing stale alarms even if an earlier clear failed after persistence.
  for (const m of state.monitors) if (!m.enabled) await syncAlarm(m);
}
async function requirePlan(
  interval: number,
  active: boolean,
  id?: string,
): Promise<void> {
  if ((await license()).paid) return;
  const reason = paidFeatureReason(
    (await readState()).monitors,
    interval,
    active,
    id,
  );
  if (reason) throw new Error(reason);
}
async function notifyPending(id: string): Promise<void> {
  const state = await readState();
  const m = state.monitors.find((m) => m.id === id);
  if (!m) return;
  for (const change of [...m.history].reverse())
    if (!change.delivered) {
      try {
        await deliver({ monitor: m, change });
        change.delivered = true;
        await writeState(state);
      } catch (error) {
        m.error = `Notification: ${errorText(error)}`;
        await writeState(state);
        break;
      }
    }
  if (
    m.error?.startsWith('Notification:') &&
    m.history.every((h) => h.delivered)
  ) {
    m.error = null;
    await writeState(state);
  }
  await updateBadge(state.monitors);
  await scheduleNotifications();
}
async function scheduleNotifications(): Promise<void> {
  const pending = (await readState()).monitors.some((m) =>
    m.history.some((h) => !h.delivered),
  );
  if (pending) {
    if (!(await api().alarms.get(NOTIFY_ALARM)))
      await api().alarms.create(NOTIFY_ALARM, { periodInMinutes: 1 });
  } else await api().alarms.clear(NOTIFY_ALARM);
}
export async function checkMonitor(id: string): Promise<void> {
  await enforcePlan();
  await notifyPending(id);
  let state = await readState();
  let m = state.monitors.find((m) => m.id === id);
  if (!m || !m.enabled) return;
  if (m.endsAt !== null && Date.now() >= m.endsAt) {
    m.enabled = false;
    await writeState(state);
    await syncAlarm(m);
    return;
  }
  // Set the next wakeup before I/O so a terminated worker does not lose the schedule.
  await syncAlarm(m);
  state = await readState();
  m = state.monitors.find((m) => m.id === id);
  if (!m) return;
  try {
    checkingId = id;
    await api().storage.session.set({ checkingMonitor: id });
    if (m.history.length >= 10 && m.history.at(-1)?.delivered === false)
      throw new Error(
        'Notification backlog is full. Checks will resume after notifications can be delivered.',
      );
    const monitor = m;
    const result = await readRegion(m, async () => {
      if (monitor.endsAt !== null && Date.now() >= monitor.endsAt)
        throw new Error(
          'Monitoring duration ended before JavaScript rendering could start.',
        );
      monitor.renderingRequired = true;
      await writeState(state);
      if (!monitor.renderingNotified) {
        await notifyRendering(monitor.id, monitor.name);
        monitor.renderingNotified = true;
        await writeState(state);
      }
    });
    if (m.endsAt !== null && Date.now() >= m.endsAt) {
      m.enabled = false;
      await writeState(state);
      await syncAlarm(m);
      return;
    }
    const updated = applySnapshot(
      m,
      result.text,
      Date.now(),
      crypto.randomUUID(),
    );
    updated.source = result.source;
    updated.snapshotHtml = result.html ?? null;
    state.monitors = state.monitors.map((item) =>
      item.id === id ? updated : item,
    );
    await writeState(state);
    await scheduleNotifications();
  } catch (error) {
    // Re-read: a failed persistence attempt must never advance the comparison baseline.
    const failed = await readState();
    const current = failed.monitors.find((item) => item.id === id);
    if (!current) return;
    current.lastCheckAt = Date.now();
    current.error = errorText(error);
    await writeState(failed);
    return;
  } finally {
    checkingId = null;
    await api().storage.session.remove('checkingMonitor');
  }
  await notifyPending(id);
}
async function handle(request: Request): Promise<View> {
  if (request.type === 'list') return view();
  if (request.type === 'purchase' || request.type === 'restore-purchase') {
    await openPurchase(request.type === 'restore-purchase');
    return view();
  }
  if (request.type === 'refresh-license') {
    await refreshLicense();
    await enforcePlan();
    return view();
  }
  if (request.type === 'clear-draft') {
    await draftSerial(async () => {
      const current = draftValue(
        (await api().storage.session.get('draft')).draft,
      );
      if (
        request.expected === undefined ||
        JSON.stringify(current) === request.expected
      )
        await api().storage.session.remove('draft');
    });
    return view();
  }
  if (request.type === 'test-selector') {
    const url = webUrl(request.url);
    const result = await readRegion(
      {
        url,
        selector: request.selector,
        renderJavaScript: request.renderJavaScript,
      },
      () => notifyRendering('preview', 'This selector preview'),
    );
    return {
      ...(await view()),
      preview: { url, selector: request.selector, ...result },
    };
  }
  if (request.type === 'pick') {
    const tab = await api().tabs.get(request.tabId);
    if (!supportedTab(tab))
      throw new Error(
        'Use a normal, non-private, non-container tab to select a region.',
      );
    if (tab.url !== webUrl(request.url))
      throw new Error('The selected tab changed. Choose it again.');
    if (
      !(await api().permissions.contains({
        origins: [originPattern(request.url)],
      }))
    )
      throw new Error('Grant access to this site before selecting a region.');
    const token = crypto.randomUUID();
    await api().storage.session.set({
      pendingPick: {
        token,
        tabId: request.tabId,
        url: request.url,
        expiresAt: Date.now() + 120000,
      },
      draft: null,
    });
    await api().scripting.executeScript({
      target: { tabId: request.tabId },
      func: startPicker,
      args: [token],
    });
    return view();
  }
  const state = await readState();
  if (request.type === 'create' || request.type === 'update') {
    const input = {
      selector: request.input.selector,
      intervalSeconds: request.input.intervalSeconds,
      durationMinutes: request.input.durationMinutes,
      renderJavaScript: !!request.input.renderJavaScript,
      url: webUrl(request.input.url),
      name: request.input.name.trim(),
    };
    if (
      !(await api().permissions.contains({
        origins: [originPattern(input.url)],
      }))
    )
      throw new Error('Site access is required. Allow access and try again.');
    const existing =
      request.type === 'update'
        ? state.monitors.find((m) => m.id === request.id)
        : undefined;
    if (request.type === 'update' && !existing)
      throw new Error('Monitor not found.');
    await requirePlan(
      input.intervalSeconds,
      request.type === 'create' || !!existing?.enabled,
      existing?.id,
    );
    if (request.type === 'create') {
      if (state.monitors.length >= MAX_MONITORS)
        throw new Error(
          'The local safety limit is 20 monitors. Remove one before adding another.',
        );
      if (
        state.monitors.some(
          (m) => m.url === input.url && m.selector === input.selector,
        )
      )
        throw new Error(
          'This region is already monitored. Edit the existing monitor.',
        );
      const m: Monitor = {
        ...input,
        id: crypto.randomUUID(),
        endsAt:
          input.durationMinutes === null
            ? null
            : Date.now() + input.durationMinutes * 60000,
        enabled: true,
        snapshot: null,
        lastCheckAt: null,
        lastChangeAt: null,
        error: null,
        source: null,
        history: [],
        unread: 0,
      };
      state.monitors.push(m);
      await writeState(state);
      await draftSerial(() => api().storage.session.remove('draft'));
      await syncAlarm(m);
      // Worker owns the check, independent of the panel lifetime.
      void serial(() => checkMonitor(m.id)).catch(report);
    } else {
      const m = state.monitors.find((m) => m.id === request.id);
      if (!m) throw new Error('Monitor not found.');
      if (
        m.url !== input.url ||
        m.selector !== input.selector ||
        !!m.renderJavaScript !== !!input.renderJavaScript
      ) {
        m.renderingRequired = false;
        m.renderingNotified = false;
        m.source = null;
        m.snapshot = null;
        m.snapshotHtml = null;
        m.history = [];
        m.unread = 0;
        m.lastChangeAt = null;
        m.lastCheckAt = null;
      }
      Object.assign(m, input, {
        endsAt:
          input.durationMinutes === null
            ? null
            : Date.now() + input.durationMinutes * 60000,
        error: null,
      });
      await writeState(state);
      await syncAlarm(m);
      await updateBadge(state.monitors);
      await draftSerial(() => api().storage.session.remove('draft'));
    }
    return view();
  }
  const m = state.monitors.find((m) => m.id === request.id);
  if (!m) throw new Error('Monitor not found.');
  if (request.type === 'check') {
    if (!m.enabled) throw new Error('Resume this monitor before checking.');
    await checkMonitor(m.id);
  } else if (request.type === 'delete') {
    state.monitors = state.monitors.filter((item) => item.id !== m.id);
    await writeState(state);
    await api().alarms.clear(PREFIX + m.id);
    await scheduleNotifications();
    await updateBadge(state.monitors);
  } else if (request.type === 'read') {
    m.unread = 0;
    await writeState(state);
    await updateBadge(state.monitors);
  } else if (request.type === 'toggle') {
    if (request.enabled) await requirePlan(m.intervalSeconds, true, m.id);
    m.enabled = request.enabled;
    if (m.enabled) {
      m.endsAt =
        m.durationMinutes === null
          ? null
          : Date.now() + m.durationMinutes * 60000;
      m.error = null;
    }
    await writeState(state);
    await syncAlarm(m);
  }
  return view();
}
export function trustedPanel(sender: chrome.runtime.MessageSender): boolean {
  return (
    sender.id === api().runtime.id &&
    sender.url === api().runtime.getURL('sidepanel.html') &&
    (sender.frameId === undefined || sender.frameId === 0)
  );
}
api().runtime.onMessage.addListener((message: unknown, sender, respond) => {
  if (
    message &&
    typeof message === 'object' &&
    'type' in message &&
    message.type === 'parse'
  )
    return;
  if (
    message &&
    typeof message === 'object' &&
    'type' in message &&
    message.type === 'picked'
  ) {
    void serial(async () => {
      const pending = pendingValue(
        (await api().storage.session.get('pendingPick')).pendingPick,
      );
      const value = message as Record<string, unknown>;
      if (
        !pending ||
        sender.id !== api().runtime.id ||
        sender.tab?.id !== pending.tabId ||
        !supportedTab(sender.tab) ||
        sender.frameId !== 0 ||
        sender.url !== pending.url ||
        value.token !== pending.token ||
        Date.now() > pending.expiresAt
      )
        throw new Error('Selection expired or came from a different page.');
      await api().storage.session.remove('pendingPick');
      if (value.cancelled !== true) {
        if (
          typeof value.selector !== 'string' ||
          !value.selector ||
          value.selector.length > 2000 ||
          typeof value.sample !== 'string' ||
          !value.sample ||
          value.sample.length > 8000 ||
          typeof value.title !== 'string'
        )
          throw new Error('Invalid selection.');
        const draft: Draft = {
          url: pending.url,
          selector: value.selector,
          sample: value.sample,
          title: value.title.slice(0, 100),
        };
        await draftSerial(() => api().storage.session.set({ draft }));
      }
      return { ok: true };
    }).then(respond, (error) =>
      respond({ ok: false, error: errorText(error) }),
    );
    return true;
  }
  if (!trustedPanel(sender) || !requestValid(message)) {
    respond({ ok: false, error: 'Unauthorized or invalid request.' });
    return;
  }
  if (
    message.type === 'check' &&
    (requestedChecks.has(message.id) || checkingId === message.id)
  ) {
    respond({
      ok: false,
      error: 'A check is already in progress for this monitor.',
    });
    return;
  }
  if (message.type === 'check') requestedChecks.add(message.id);
  const operation =
    message.type === 'list' || message.type === 'clear-draft'
      ? ready.then(() => handle(message))
      : serial(() => handle(message));
  void operation
    .finally(() => {
      if (message.type === 'check') requestedChecks.delete(message.id);
    })
    .then(
      (value) => respond({ ok: true, value }),
      (error) => respond({ ok: false, error: errorText(error) }),
    );
  return true;
});
async function initialize(): Promise<void> {
  await initializePlatform();
  await initializePayments().catch(() => {});
  await enforcePlan();
  await cleanupRenderingTabs();
  await api().storage.session.remove('checkingMonitor');
  const state = await readState();
  let changed = false;
  for (const m of state.monitors) {
    if (m.enabled && m.endsAt !== null && m.endsAt <= Date.now()) {
      m.enabled = false;
      changed = true;
    }
  }
  if (changed) await writeState(state);
  const alarms = await api().alarms.getAll();
  for (const alarm of alarms)
    if (
      alarm.name.startsWith(PREFIX) &&
      !state.monitors.some((m) => m.enabled && PREFIX + m.id === alarm.name)
    )
      await api().alarms.clear(alarm.name);
  for (const m of state.monitors)
    if (m.enabled && !alarms.some((a) => a.name === PREFIX + m.id))
      await syncAlarm(m);
  await updateBadge(state.monitors);
  for (const m of state.monitors) await notifyPending(m.id);
  await scheduleNotifications();
}
function report(error: unknown) {
  console.error('Page Monitor operation failed:', errorText(error));
}
api().tabs.onActivated.addListener(({ tabId }) => {
  void releaseRenderingTab(tabId).catch(report);
});
api().alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === LICENSE_ALARM) {
    void serial(async () => {
      try {
        await refreshLicense();
        await enforcePlan();
      } finally {
        await settleLicenseAlarm();
      }
    }).catch(() => {});
    return;
  }
  if (alarm.name === RENDER_CLEANUP_ALARM) {
    void cleanupRenderingTabs().catch(report);
    return;
  }
  if (alarm.name === NOTIFY_ALARM)
    void serial(async () => {
      for (const m of (await readState()).monitors) await notifyPending(m.id);
    }).catch(report);
  else if (alarm.name.startsWith(PREFIX))
    void serial(() => checkMonitor(alarm.name.slice(PREFIX.length))).catch(
      report,
    );
});
api().runtime.onInstalled.addListener(() => {
  void serial(initialize).catch(report);
});
api().runtime.onStartup.addListener(() => {
  void serial(initialize).catch(report);
});
api().permissions.onRemoved.addListener(() => {
  void serial(async () => {
    const state = await readState();
    for (const m of state.monitors)
      if (
        !(await api().permissions.contains({
          origins: [originPattern(m.url)],
        }))
      )
        m.error =
          'Site access was removed. Edit this monitor to grant access again.';
    await writeState(state);
  }).catch(report);
});
api().notifications.onClicked.addListener((notificationId) => {
  void serial(async () => {
    const id = notificationId.split(':')[1];
    const m = (await readState()).monitors.find((m) => m.id === id);
    if (m) {
      const tabs = await api().tabs.query({ url: originPattern(m.url) });
      const tab = tabs.find((t) => t.url === m.url && supportedTab(t));
      if (tab?.id !== undefined) {
        await api().tabs.update(tab.id, { active: true });
        await api().windows.update(tab.windowId, { focused: true });
      } else await api().tabs.create({ url: m.url });
    }
  }).catch(report);
});
registerToolbar(report);
const ready = serial(initialize);
void ready.catch(report);
