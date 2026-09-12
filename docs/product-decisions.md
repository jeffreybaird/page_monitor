# Core monitor decisions

These decisions reflect the user's approved scope, superseding the monetization
and launch proposals in the original rough plan.

- A side panel manages monitoring of selected page text.
- Checks continue after tabs close. Try background requests first; when selected
  text needs JavaScript, open a temporary inactive tab with the user's session.
  Alert before the first rendering check and retain a visible monitor notice.
  This supersedes the earlier background-requests-only constraint. Never reload
  an existing user tab. Preserve temporary tabs the user activates.
- Existing tabs use the rendered page. Background requests use the user's browser
  session; login failures are visible and never overwrite a successful baseline.
- Check interval and duration are configurable; duration can be unlimited.
- Continue monitoring after each change; desktop alerts and a badge are sufficient.
  Notification delivery has an adapter boundary for future channels.
- Initial detection is any normalized text change. Thresholds, regular expressions,
  screenshots, sound, launch dates, and cloud checks are deferred. Paid plans
  follow the lifetime licensing decision below.
- Begin with generic HTTP/HTTPS support and the authenticated Elixir dashboard as
  a reference; show capability limits rather than promising all pages work.
- Expand across HTTP/HTTPS sites with per-origin access. Open-tab selection supports
  nested open shadow roots and same-origin frames. Existing CSS selectors remain
  valid; component paths are bounded to eight steps. Cross-origin frame access
  and separate nested-frame background requests remain unsupported.
- A single worker owns durable state. The first check sets a baseline. Subsequent
  changes persist before notification. Failed checks retain the last baseline.
- A resumed monitor restarts its duration. Editing its settings resets its end
  time; changing the URL or selector clears old comparison/history data.
- Match the complete saved URL, including query and fragment, to an existing tab.
  Redirects during background checks are errors rather than permission expansion.
- Do not silently choose a different region after a missing or ambiguous selector.

The scaffold uses strict TypeScript, Vite, semantic HTML/CSS, Vitest, and Playwright.
A framework is unnecessary for the current side panel. Local bounded snapshots
and history fit `chrome.storage.local`, so IndexedDB and extra permissions are
unnecessary. No test-only privileged message is shipped.

Temporary rendering waits for load completion and one second of stable selected
text, with a twenty-second timeout. Users can explicitly request rendering for
placeholder-based applications. Failed renders preserve the last snapshot. Session
ownership and a cleanup alarm recover abandoned tabs after worker restarts; browser
session restoration does not grant ownership over restored user tabs.

## Desktop Firefox support

- Keep one codebase with Chrome 120+ and desktop Firefox 140+ build targets.
- Reuse the existing UI in Firefox's native sidebar. Use a non-persistent module
  background document and inert HTML parsing in that context; Chrome retains its
  worker/offscreen implementation.
- Preserve local monitoring, schema version 1, permissions requested at the time
  of use, and all existing checking/notification rules. No browser synchronization
  or automatic migration between browser profiles.
- Firefox host permissions cover a scheme/hostname across ports; actual page
  selection and extraction still verify the saved URL and relevant exact origins.
- Firefox container sessions are unsupported in this first port. Reject container
  selection and exclude them from reads and notification targets; if only a
  container matches a URL, do not silently check the default account instead.
- Firefox does not expose notification permission status or local-storage access
  restrictions equivalent to Chrome's APIs. Handle notification creation failures
  and document OS suppression and storage visibility without claiming parity there.
- Firefox Android, Safari, signing and public distribution are outside this change.

## Lifetime license

- $2.99 USD once for lifetime access to intervals below five minutes and more than
  three active monitors. Free intervals start at exactly five minutes. Retain the
  30-second minimum and 20-saved-monitor safety cap. Screenshots remain future paid scope.
- Use ExtensionPay with a configured product ID; absent configuration is free-only.
- Preserve settings/history when pausing existing monitors outside free limits;
  keep the first three eligible active monitors in saved order. Users resume explicitly.
- Verified paid access persists offline. Failed checks never downgrade it; a
  successful unpaid provider response does. Payments do not transmit monitored content.
- Setup, data retention, recovery and release checks are in [payments.md](payments.md).
