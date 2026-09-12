# Core monitor decisions

These decisions reflect the user's approved scope, superseding the monetization
and launch proposals in the original rough plan.

- A side panel manages monitoring of selected page text.
- Checks continue after tabs close, using background requests only. Never open
  temporary tabs and never reload a user's existing tab automatically.
- Existing tabs use the rendered page. Background requests use the user's browser
  session; login failures are visible and never overwrite a successful baseline.
- Check interval and duration are configurable; duration can be unlimited.
- Continue monitoring after each change; desktop alerts and a badge are sufficient.
  Notification delivery has an adapter boundary for future channels.
- Initial detection is any normalized text change. Thresholds, regular expressions,
  screenshots, sound, paid plans, launch dates, and cloud checks are deferred.
- Begin with generic HTTP/HTTPS support and the authenticated Elixir dashboard as
  a reference; show capability limits rather than promising all pages work.
- Expand across HTTP/HTTPS sites with per-origin access. Open-tab selection supports
  nested open shadow roots and same-origin frames. Existing CSS selectors remain
  valid; component paths are bounded to eight steps. No cross-origin frame access,
  temporary tabs, or nested-frame background requests are introduced.
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
