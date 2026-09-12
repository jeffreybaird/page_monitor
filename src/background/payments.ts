import ExtPay from 'extpay';
import { paymentConsentGranted } from '../shared/payment-consent';
import { api } from '../platform/api';

const PRODUCT_ID = import.meta.env.VITE_EXTPAY_EXTENSION_ID?.trim() ?? '';
export const LICENSE_KEY = 'pageMonitorLicense';
export const LICENSE_ALARM = 'license-refresh';
const PENDING_KEY = 'pageMonitorPurchaseUntil';
export type License = { paid: boolean; configured: boolean };
let client: ReturnType<typeof ExtPay> | undefined;

function provider() {
  if (!PRODUCT_ID)
    throw new Error('Purchases are not available in this build yet.');
  client ??= ExtPay(PRODUCT_ID);
  return client;
}

async function bounded<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('License service timed out. Try again.')),
          10000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function license(): Promise<License> {
  const saved: unknown = (await api().storage.local.get(LICENSE_KEY))[
    LICENSE_KEY
  ];
  const paid =
    !!PRODUCT_ID &&
    !!saved &&
    typeof saved === 'object' &&
    'productId' in saved &&
    saved.productId === PRODUCT_ID &&
    'paid' in saved &&
    saved.paid === true;
  return { paid, configured: !!PRODUCT_ID };
}

/** Only a provider response can change entitlement; failures preserve offline access. */
export async function refreshLicense(): Promise<License> {
  if (!PRODUCT_ID) return license();
  if (!(await paymentConsentGranted()))
    throw new Error(
      'Allow licensing data access before checking your purchase.',
    );
  const user: unknown = await bounded(provider().getUser());
  if (
    !user ||
    typeof user !== 'object' ||
    !('paid' in user) ||
    typeof user.paid !== 'boolean'
  )
    throw new Error('License service returned an invalid response. Try again.');
  if (
    user.paid &&
    (!('plan' in user) ||
      !user.plan ||
      typeof user.plan !== 'object' ||
      !('interval' in user.plan) ||
      user.plan.interval !== 'once')
  )
    throw new Error(
      'A lifetime purchase could not be verified. Contact support.',
    );
  await api().storage.local.set({
    [LICENSE_KEY]: { productId: PRODUCT_ID, paid: user.paid },
  });
  return license();
}

export async function openPurchase(restore: boolean): Promise<void> {
  if (!(await paymentConsentGranted()))
    throw new Error(
      'Allow licensing data access before opening your purchase.',
    );
  const extpay = provider();
  // Persist recovery before opening a page; panel/worker closure cannot lose it.
  await api().storage.local.set({ [PENDING_KEY]: Date.now() + 15 * 60000 });
  await api().alarms.create(LICENSE_ALARM, { periodInMinutes: 1 });
  if (restore) await extpay.openLoginPage();
  else {
    // Refuse to advertise $2.99 then send a customer to a different price/plan.
    const plans = await bounded(extpay.getPlans());
    if (
      !Array.isArray(plans) ||
      plans.length !== 1 ||
      plans[0]?.interval !== 'once' ||
      plans[0]?.unitAmountCents !== 299 ||
      plans[0]?.currency !== 'usd'
    )
      throw new Error(
        'The $2.99 lifetime purchase is not configured correctly. Please try again later.',
      );
    await extpay.openPaymentPage();
  }
}

export async function initializePayments(): Promise<void> {
  if (!PRODUCT_ID) return;
  if (!(await api().alarms.get(LICENSE_ALARM))) {
    const until: unknown = (await api().storage.local.get(PENDING_KEY))[
      PENDING_KEY
    ];
    const pending =
      typeof until === 'number' && Number.isFinite(until) && until > Date.now();
    await api().alarms.create(LICENSE_ALARM, {
      periodInMinutes: pending ? 1 : 1440,
    });
  }
  // Network verification belongs to the durable alarm or explicit refresh.
  // Worker activation must not delay local monitoring with a provider request.
}

export async function settleLicenseAlarm(): Promise<void> {
  const until: unknown = (await api().storage.local.get(PENDING_KEY))[
    PENDING_KEY
  ];
  if (
    (await license()).paid ||
    typeof until !== 'number' ||
    !Number.isFinite(until) ||
    until <= Date.now()
  ) {
    await api().alarms.create(LICENSE_ALARM, { periodInMinutes: 1440 });
    await api().storage.local.remove(PENDING_KEY);
  }
}
