import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ browserName: 'Firefox' }));
vi.mock('#platform', () => ({
  get browserName() {
    return platform.browserName;
  },
}));

const requiredData = [
  'authenticationInfo',
  'personallyIdentifyingInfo',
  'financialAndPaymentInfo',
];
const getAll = vi.fn<() => Promise<unknown>>();
const request = vi.fn<() => Promise<boolean>>();

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  platform.browserName = 'Firefox';
  getAll.mockResolvedValue({ data_collection: [] });
  request.mockResolvedValue(false);
  vi.stubGlobal('browser', undefined);
  vi.stubGlobal('chrome', { permissions: { getAll, request } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('payment data consent', () => {
  it('requests all payment categories synchronously from the prepared user gesture', async () => {
    const consent = await import('../../src/shared/payment-consent');
    await consent.preparePaymentConsent();
    expect(request).not.toHaveBeenCalled();
    let grant: (value: boolean) => void = () => {};
    request.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          grant = resolve;
        }),
    );

    const result = consent.requestPaymentConsent();

    // Assert before yielding: an asynchronous preflight would lose the gesture.
    expect(request).toHaveBeenCalledExactlyOnceWith({
      data_collection: requiredData,
    });
    expect(getAll).toHaveBeenCalledOnce();
    grant(true);
    expect(await result).toBe(true);
    getAll.mockResolvedValue({ data_collection: requiredData });
    expect(await consent.paymentConsentGranted()).toBe(true);
  });

  it('returns denied consent without recording a grant or requesting again', async () => {
    const consent = await import('../../src/shared/payment-consent');
    await consent.preparePaymentConsent();

    expect(await consent.requestPaymentConsent()).toBe(false);
    expect(await consent.paymentConsentGranted()).toBe(false);
    expect(request).toHaveBeenCalledOnce();
  });

  it('checks current grants after revocation instead of trusting preparation or a prior request', async () => {
    getAll.mockResolvedValue({ data_collection: requiredData });
    const consent = await import('../../src/shared/payment-consent');
    await consent.preparePaymentConsent();
    expect(await consent.paymentConsentGranted()).toBe(true);

    getAll.mockResolvedValue({ data_collection: requiredData.slice(0, 2) });
    expect(await consent.paymentConsentGranted()).toBe(false);
    getAll.mockResolvedValue({ data_collection: [] });
    expect(await consent.paymentConsentGranted()).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    null,
    'invalid',
    { data_collection: null },
    { data_collection: 'authenticationInfo' },
    { data_collection: [...requiredData, 7] },
  ])('fails closed on malformed permission data: %j', async (permissions) => {
    getAll.mockResolvedValue(permissions);
    const consent = await import('../../src/shared/payment-consent');

    await expect(consent.preparePaymentConsent()).rejects.toThrow(
      'Could not check licensing permissions',
    );
    expect(await consent.paymentConsentGranted()).toBe(false);
    await expect(consent.requestPaymentConsent()).rejects.toThrow(
      'still loading',
    );
    expect(request).not.toHaveBeenCalled();
  });

  it('fails closed when the browser cannot read permissions', async () => {
    getAll.mockRejectedValue(new Error('Permission API unavailable'));
    const consent = await import('../../src/shared/payment-consent');

    await expect(consent.preparePaymentConsent()).rejects.toThrow(
      'API unavailable',
    );
    expect(await consent.paymentConsentGranted()).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });

  it('propagates native request failure without granting authorization', async () => {
    const consent = await import('../../src/shared/payment-consent');
    await consent.preparePaymentConsent();
    request.mockRejectedValue(new Error('No user gesture'));

    await expect(consent.requestPaymentConsent()).rejects.toThrow(
      'No user gesture',
    );
    expect(await consent.paymentConsentGranted()).toBe(false);
  });

  it('does not invoke Firefox consent APIs on Chrome', async () => {
    platform.browserName = 'Chrome';
    getAll.mockRejectedValue(new Error('Should not be called'));
    const consent = await import('../../src/shared/payment-consent');

    await consent.preparePaymentConsent();
    expect(await consent.requestPaymentConsent()).toBe(true);
    expect(await consent.paymentConsentGranted()).toBe(true);
    expect(getAll).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('allows older Firefox without passing unsupported data_collection options', async () => {
    getAll.mockResolvedValue({ permissions: ['storage'], origins: [] });
    const consent = await import('../../src/shared/payment-consent');

    await consent.preparePaymentConsent();
    expect(await consent.requestPaymentConsent()).toBe(true);
    expect(await consent.paymentConsentGranted()).toBe(true);
    expect(request).not.toHaveBeenCalled();
  });
});
