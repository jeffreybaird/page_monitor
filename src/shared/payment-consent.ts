import { browserName } from '#platform';
import { api } from '../platform/api';

const PAYMENT_DATA = [
  'authenticationInfo',
  'personallyIdentifyingInfo',
  'financialAndPaymentInfo',
];
let supportsDataConsent: boolean | undefined;

async function dataPermissions(): Promise<string[] | null> {
  if (String(browserName) !== 'Firefox') return null;
  const permissions: unknown = await api().permissions.getAll();
  if (!permissions || typeof permissions !== 'object')
    throw new Error('Could not check licensing permissions. Reopen the panel.');
  // Firefox before data-collection consent omits this property entirely.
  if (!('data_collection' in permissions)) return null;
  const values: unknown = permissions.data_collection;
  if (
    !Array.isArray(values) ||
    !values.every((value) => typeof value === 'string')
  )
    throw new Error('Could not check licensing permissions. Reopen the panel.');
  return values;
}

/** Resolve feature support before enabling the user-gesture purchase controls. */
export async function preparePaymentConsent(): Promise<void> {
  supportsDataConsent = (await dataPermissions()) !== null;
}

/** Call directly in the click handler, before awaiting any other operation. */
export function requestPaymentConsent(): Promise<boolean> {
  if (supportsDataConsent === undefined)
    return Promise.reject(
      new Error('Licensing permissions are still loading.'),
    );
  if (!supportsDataConsent) return Promise.resolve(true);
  // Chrome's types omit Firefox's documented extension to permissions.request.
  const permissions = api().permissions as unknown as {
    request(value: { data_collection: string[] }): Promise<boolean>;
  };
  return permissions.request({ data_collection: [...PAYMENT_DATA] });
}

/** Always read current grants: cached UI support is not authorization. */
export async function paymentConsentGranted(): Promise<boolean> {
  try {
    const granted = await dataPermissions();
    return (
      granted === null || PAYMENT_DATA.every((name) => granted.includes(name))
    );
  } catch {
    return false;
  }
}
