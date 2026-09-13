# Store listing copy

Status: ready to paste after payment configuration and release blockers in
`readiness.md` are resolved. Do not advertise working paid checkout for a build
without its registered product ID.

## Shared listing

Name: Page Monitor

Short description (manifest):
Monitor DOM text with CSS selectors, configurable polling intervals, and local change history.

Category: Productivity (Chrome); Alerts & Updates (Firefox, if available).
Language: English.
Price: Free download with an optional $2.99 USD one-time lifetime purchase.

### Detailed description

Page Monitor polls selected DOM text and reports changes in a browser side panel.
Select an element on the page or specify a CSS selector. Each monitor stores its
URL, selector, interval, current text and recent diffs locally.

Use it for build dashboards, service status pages, release listings, or other
HTML pages where you need to track a specific value or section.

Configuration:

- HTTP(S) URL and CSS selector, with a visual element picker and selector test.
- Per-monitor interval and optional duration.
- Background HTML requests using the available browser session.
- Optional JavaScript rendering for pages whose initial HTML lacks the selected text.

Behavior:

- An existing matching tab is read without reloading it.
- With the tab closed, the extension first requests the page's HTML. If the region
  requires JavaScript, it opens a temporary inactive tab. A notice precedes the
  first rendering check. Activating that tab keeps it open.
- The first successful read sets the baseline. Later normalized-text changes
  produce a desktop notification and update the unread badge.
- The side panel shows text diffs, current content and up to ten changes per monitor.
- Missing or ambiguous selectors report an error; the extension does not silently
  switch to a different region. Failed reads retain the last successful baseline.

Limits:

- Free: three active monitors; intervals of five minutes or longer.
- $2.99 USD once: lifetime access to intervals from 30 seconds and more active
  monitors. Maximum 20 saved monitors on either tier. Payment/restoration uses
  ExtensionPay and Stripe; there is no subscription.
- Maximum 8,000 characters per selected region and ten stored changes per monitor.
- The browser must be running and the computer awake. Scheduled checks may be
  delayed. Authenticated pages require a valid browser session.

Data stays in the local browser profile. Monitor URLs, selectors and content are
not uploaded to the developer or payment provider. There is no analytics or
monitor synchronization. Site access is requested per origin when you select or
save a monitor. Optional licensing communicates with extensionpay.com.

This is text comparison, not screenshot or pixel comparison. Browser internal
pages, PDF viewers, cross-origin frames, closed shadow roots and private windows
are unsupported. Some sites require an open tab or cannot be monitored reliably.

### Browser-specific ending

Chrome: Requires Chrome 120 or newer. Click the toolbar icon to open the side panel.

Firefox: Requires desktop Firefox 140 or newer. Click the toolbar icon to open the
sidebar. Firefox containers and Firefox for Android are unsupported. Monitor data
is separate from any Chrome installation.

## Listing links

- Support URL: set `supportUrl` in `release.json` to a monitored public contact route.
- Privacy URL: publish the policy in `privacy-policy.md` and set `privacyUrl`.
- Homepage: optional; do not invent a site.
- Source repository: currently private. Provide an approved public source/rebuild
  download location before distribution; do not use the private GitHub URL as a
  public source offer.

## Images

Run `npm run submission:assets`. `artifacts/submission/assets/` contains a
440×280 promotional image and 1280×800 screenshots. Screenshots use synthetic
build-dashboard and service-status examples in the actual compiled UI. They
show the actual interface with fixture data and a configured demo product ID.
They do not show a live payment. Copy the packaged 128×128 icon for the store icon.

References: [Chrome listing fields](https://developer.chrome.com/docs/webstore/cws-dashboard-listing),
[Chrome image requirements](https://developer.chrome.com/docs/webstore/images),
[AMO submission](https://extensionworkshop.com/documentation/publish/submitting-an-add-on/).
