import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  deliver,
  notifyRendering,
  type ChangeNotice,
} from '../../src/background/notifiers';

vi.mock('#platform', () => import('../../src/platform/firefox'));

const create = vi.fn();
const notice: ChangeNotice = {
  monitor: {
    id: 'monitor1',
    name: 'Price',
    url: 'https://example.com/price',
    selector: '#price',
    intervalSeconds: 60,
    durationMinutes: null,
    endsAt: null,
    enabled: true,
    snapshot: '42',
    lastCheckAt: 1,
    lastChangeAt: 1,
    error: null,
    source: 'background',
    history: [],
    unread: 1,
  },
  change: { id: 'change1', at: 1, before: '40', after: '42', delivered: false },
};

beforeEach(() => {
  create.mockReset().mockResolvedValue('notification-id');
  vi.stubGlobal('browser', {
    // Firefox has no getPermissionLevel: do not supply a misleading mock.
    notifications: { create },
    runtime: { getURL: (path: string) => `moz-extension://test/${path}` },
  });
});
afterEach(() => vi.unstubAllGlobals());

it('delivers a Firefox basic notification without unsupported contextMessage', async () => {
  await expect(deliver(notice)).resolves.toBeUndefined();
  expect(create).toHaveBeenCalledExactlyOnceWith('change:monitor1:change1', {
    type: 'basic',
    iconUrl: 'moz-extension://test/icons/128.png',
    title: 'Price changed',
    message: '40 → 42',
  });
});

it('propagates change notification rejection so delivery remains retryable', async () => {
  const failure = new Error('Notification service unavailable');
  create.mockRejectedValue(failure);
  await expect(deliver(notice)).rejects.toBe(failure);
  expect(create).toHaveBeenCalledOnce();
  expect(notice.change.delivered).toBe(false);
});

it('creates the rendering warning using only Firefox notification fields', async () => {
  await expect(notifyRendering('monitor1', 'Price')).resolves.toBeUndefined();
  expect(create).toHaveBeenCalledExactlyOnceWith('rendering:monitor1', {
    type: 'basic',
    iconUrl: 'moz-extension://test/icons/128.png',
    title: 'JavaScript rendering required',
    message:
      'Price needs a temporary inactive tab for closed-tab checks. It uses your browser session and closes after checking.',
  });
});

it('propagates rendering-warning rejection rather than authorizing rendering', async () => {
  const failure = new Error('Notifications disabled');
  create.mockRejectedValue(failure);
  await expect(notifyRendering('monitor1', 'Price')).rejects.toBe(failure);
  expect(create).toHaveBeenCalledOnce();
});
