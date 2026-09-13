# Reviewer instructions

Page Monitor has one purpose: monitor user-selected webpage text and notify the
user when it changes. No developer server is needed for monitoring. The optional
paid tier is $2.99 USD once; free features need no account.

## Reproduce the build

Use the source ZIP and its `BUILD-INFO.json`; follow `build.md`. The source includes
the exact public product ID used for each build, the package lock, and the small
ExtPay build transformations in `vite.config.ts`. No remote executable code is
loaded. JavaScript on monitored sites executes only as that site's normal page
code when a temporary tab is needed; fetched text is never evaluated as code.

## Free monitoring

1. Install the extension. Click its toolbar icon to open the side panel/sidebar.
2. Open an ordinary HTTP(S) page with visible text. Use **Select region in current
   tab** or enter its URL and a CSS selector. Grant only that site's access.
3. Use **Test selector** to verify a single nonempty region. Save with a five-minute
   interval. The first successful read creates the baseline, with no change alert.
4. Change the page's selected text, or use another deterministic fixture. Use
   **Check now**. Inspect the highlighted before/after change and unread badge.
5. Pause, resume, edit and delete the monitor. History stays local. The fourth
   active monitor or an interval below five minutes prompts for a lifetime license.

A reviewer can serve a local HTML file containing `<p id="price">40</p>` over
HTTP, select `#price`, close the tab, replace 40 with 41 in that file and run
**Check now**. This needs no third-party account. The automated browser harness
uses isolated local fixtures and blocks external traffic.

## Paid path — publisher must finish before submission

Supply review access through the provider's supported mechanism in the store's
private reviewer field, after testing it on a signed/store installation. Do not
put payment credentials or license tokens in this document or the public source.
No production bypass, hard-coded paid flag, or shared customer account is shipped.

Confirm the registered product has one USD 299-cent one-time plan. Test purchase,
restore, offline use and unpaid/refund status. Checkout completion alone grants
nothing; only a provider response verifies lifetime access. Without the product
ID, purchase buttons explicitly say the build is unconfigured and are disabled.

## Browser specifics

Chrome: 120+, module service worker, native side panel, offscreen inert HTML parsing.
Firefox: desktop 140+, event background document, native sidebar, inert parsing in
that context. No private windows or Firefox containers. Do not install a previously
used development profile during review; monitor data is profile-local.

Closed pages first use a background request with the browser session. If selected
text needs JavaScript, a temporary inactive tab is opened after a visible warning.
It is closed after reading unless the user activates it. Existing user tabs are
not reloaded. Notifications depend on OS/browser settings.

## Known validator warnings

Existing Mozilla warnings concern two reviewed uses of inert HTML parsing and the
Android minimum-version compatibility of data declarations. Firefox Android is
not supported. No warning has been suppressed or treated as approval to publish.
