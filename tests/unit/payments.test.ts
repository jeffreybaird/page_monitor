import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const sdk = vi.hoisted(() => ({
  consent: vi.fn(),
  getUser: vi.fn(),
  getPlans: vi.fn(),
  openPaymentPage: vi.fn(),
  openLoginPage: vi.fn(),
  startBackground: vi.fn(),
}));
vi.mock('../../src/shared/payment-consent', () => ({
  paymentConsentGranted: sdk.consent,
}));
vi.mock('extpay', () => ({ default: () => sdk }));
let data: Record<string, unknown>;
let set: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  sdk.consent.mockResolvedValue(true);
  vi.stubEnv('VITE_EXTPAY_EXTENSION_ID', 'test-product');
  data = {};
  set = vi.fn(async (values: Record<string, unknown>) => {
    Object.assign(data, structuredClone(values));
  });
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: data[key] }),
        set,
        remove: async (key: string) => {
          delete data[key];
        },
      },
    },
    alarms: { create: vi.fn(), get: vi.fn() },
  });
  sdk.getUser.mockResolvedValue({ paid: true, plan: { interval: 'once' } });
  sdk.getPlans.mockResolvedValue([
    { interval: 'once', unitAmountCents: 299, currency: 'usd' },
  ]);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
describe('ExtensionPay license boundary', () => {
  it('persists verified lifetime access across worker restarts and outages', async () => {
    let payments = await import('../../src/background/payments');
    expect(await payments.refreshLicense()).toEqual({
      paid: true,
      configured: true,
    });
    vi.resetModules();
    payments = await import('../../src/background/payments');
    sdk.getUser.mockRejectedValue(new Error('offline'));
    await expect(payments.refreshLicense()).rejects.toThrow();
    expect((await payments.license()).paid).toBe(true);
    sdk.getUser.mockResolvedValue({ paid: false });
    expect((await payments.refreshLicense()).paid).toBe(false);
  });
  it('rejects malformed or subscription entitlements without granting access', async () => {
    const { refreshLicense, license } =
      await import('../../src/background/payments');
    for (const user of [
      { paid: 'true' },
      null,
      { paid: true },
      { paid: true, plan: { interval: 'month' } },
    ]) {
      sdk.getUser.mockResolvedValue(user);
      await expect(refreshLicense()).rejects.toThrow();
      expect((await license()).paid).toBe(false);
    }
    expect(set).not.toHaveBeenCalled();
  });
  it('does not report success after a failed entitlement write', async () => {
    const { refreshLicense, license } =
      await import('../../src/background/payments');
    set.mockRejectedValue(new Error('quota'));
    await expect(refreshLicense()).rejects.toThrow('quota');
    expect((await license()).paid).toBe(false);
  });
  it('denied or revoked consent prevents all provider operations', async () => {
    sdk.consent.mockResolvedValue(false);
    const { refreshLicense, openPurchase } =
      await import('../../src/background/payments');
    await expect(refreshLicense()).rejects.toThrow('Allow licensing data');
    await expect(openPurchase(false)).rejects.toThrow('Allow licensing data');
    await expect(openPurchase(true)).rejects.toThrow('Allow licensing data');
    expect(sdk.getUser).not.toHaveBeenCalled();
    expect(sdk.getPlans).not.toHaveBeenCalled();
    expect(sdk.openLoginPage).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });
  it('requires an exact price and one-time plan before opening checkout', async () => {
    const { openPurchase, license } =
      await import('../../src/background/payments');
    sdk.getPlans.mockResolvedValue([
      { interval: 'month', unitAmountCents: 299, currency: 'usd' },
    ]);
    await expect(openPurchase(false)).rejects.toThrow(
      'not configured correctly',
    );
    expect(sdk.openPaymentPage).not.toHaveBeenCalled();
    sdk.getPlans.mockResolvedValue([
      { interval: 'once', unitAmountCents: 299, currency: 'usd' },
    ]);
    await openPurchase(false);
    expect(sdk.openPaymentPage).toHaveBeenCalledOnce();
    expect((await license()).paid).toBe(false);
    await openPurchase(true);
    expect(sdk.openLoginPage).toHaveBeenCalledOnce();
  });
  it('stays free with no product ID and ignores licenses for a different product', async () => {
    vi.stubEnv('VITE_EXTPAY_EXTENSION_ID', '');
    const { license, refreshLicense, openPurchase } =
      await import('../../src/background/payments');
    data.pageMonitorLicense = { productId: 'other', paid: true };
    expect(await license()).toEqual({ paid: false, configured: false });
    await refreshLicense();
    expect(sdk.getUser).not.toHaveBeenCalled();
    await expect(openPurchase(false)).rejects.toThrow('not available');
  });
  it('recovers fast polling after a worker restart and bounds its duration', async () => {
    const { initializePayments, settleLicenseAlarm } =
      await import('../../src/background/payments');
    data.pageMonitorPurchaseUntil = Date.now() + 60000;
    await initializePayments();
    expect(chrome.alarms.create).toHaveBeenLastCalledWith('license-refresh', {
      periodInMinutes: 1,
    });
    expect(sdk.getUser).not.toHaveBeenCalled();
    data.pageMonitorPurchaseUntil = Date.now() - 1;
    await settleLicenseAlarm();
    expect(chrome.alarms.create).toHaveBeenLastCalledWith('license-refresh', {
      periodInMinutes: 1440,
    });
    expect(data.pageMonitorPurchaseUntil).toBeUndefined();
  });
  it('bounds hung verification and never applies a late result', async () => {
    vi.useFakeTimers();
    let resolveUser: (value: unknown) => void = () => {};
    sdk.getUser.mockReturnValue(
      new Promise((resolve) => {
        resolveUser = resolve;
      }),
    );
    const { refreshLicense, license } =
      await import('../../src/background/payments');
    const result = expect(refreshLicense()).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(10001);
    await result;
    resolveUser({ paid: true, plan: { interval: 'once' } });
    await Promise.resolve();
    expect((await license()).paid).toBe(false);
  });
});
