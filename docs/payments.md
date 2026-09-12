# Lifetime payments

Free users may run three active monitors at intervals of five minutes or longer.
A $2.99 USD one-time lifetime purchase unlocks 30-second to under-five-minute
intervals and more active monitors. The existing 20-saved-monitor safety limit
still applies. Screenshots are a future paid feature, not included functionality.

## ExtensionPay setup

1. Register an extension at https://extensionpay.com/ and connect your Stripe account.
2. Configure exactly one active plan: USD, 299 cents, one-time payment. Enable
   restoration for customers who reinstall or use another browser/device.
3. Copy `.env.example` to `.env.local` and set `VITE_EXTPAY_EXTENSION_ID` to the
   registered ExtensionPay ID. It is public configuration, not a secret key.
4. Run `npm run verify` and `npm run test:e2e`, then load the build. Test an actual
   development purchase and restoration through the registered provider account.
   Production charging requires provider configuration and store distribution;
   building or pushing this repository does not publish either store listing.

Without the ID, the extension runs free-only and labels purchase controls as
unavailable. It never opens a sample product or grants a development entitlement.
The checkout adapter refuses any configuration other than a single $2.99 USD
one-time plan. Price is enforced at checkout; entitlement requires the provider's
paid status and a one-time plan. Discounts do not invalidate an existing license.

ExtensionPay advertises a 5% transaction fee and uses Stripe processing. Current
terms and fees: https://extensionpay.com/. The bundled ExtPay 3.1.2 SDK is
AGPL-3.0-or-later; review its distribution/source obligations before releasing the
extension. This change does not assign a new license to the project.

## Persistence and recovery

The background context owns the entitlement. Page messages and checkout-page
navigation cannot grant payment. License refresh verifies provider data before
persisting `{ productId, paid }` in `pageMonitorLicense`. Failed validation or
writes never report an upgrade. A verified lifetime license remains usable offline;
an explicit successful unpaid response removes access. Local extension code and
storage can be modified by the device owner; this is not tamper-proof DRM.

A durable alarm checks daily. Purchase/restore enables one-minute polling for up
to 15 minutes, then returns to daily checks. The panel also has **Refresh license**.
Worker startup only repairs the alarm, avoiding network delays during monitoring.
Purchase completion does not automatically resume paused monitors.

On installation/upgrade, unpaid rapid monitors and monitors beyond the first three
eligible active entries in saved order are paused with a visible explanation.
Settings, snapshots and history are preserved. Pause, delete, and edits back to free
settings remain available. Expired monitors do not consume a slot. Updating an
enabled expired monitor restarts its duration and therefore checks the active cap.
The worker serializes competing mutations and enforces limits before extraction.

## Data and SDK integration

Monitoring content, page URLs, selectors and history are never sent to ExtensionPay.
ExtensionPay/Stripe handle customer email, payment and license information in their
hosted flows. ExtPay stores its installation date, per-install API credential and
provider user response locally; the app stores only product ID and paid status.
Uninstalling clears local data; **Restore purchase** reactivates using the purchase
email. Browser profiles keep their monitor data separate.

The build adapts the packaged SDK to use local storage instead of sync, abort
network requests after eight seconds, and await restoration popup creation. The SDK
is statically bundled for Chrome workers; no remote executable code, content script,
SDK message listener, or checkout-page paid callback is used. Our own trusted panel
messages and durable polling own verification. Keep these small adaptations aligned
with the pinned SDK when updating it. Do not substitute the upstream development SDK.

The narrow `https://extensionpay.com/*` host permission enables licensing calls in
Firefox. Current Firefox versions request optional payment data consent from the
purchase/restore click; the worker checks current grants before contacting the
provider. Older Firefox uses the adjacent disclosure and explicit purchase action.
Revoking that consent stops provider requests while cached lifetime access remains.
Chrome restricts local storage to trusted contexts; Firefox lacks that equivalent.

## Verification

Automated tests stub provider results and run the bundled SDK in a disposable
Chromium profile with external networking blocked. They cover actual checkout and
restore tab creation, local credential storage, worker entitlement persistence,
free limits and denied operations. They do not charge a card or prove a registered
provider's live checkout. Before release, exercise payment, restoration, offline
use, refund/revocation and Firefox native consent on both supported browsers.
