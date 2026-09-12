# Page Monitor

A local Chrome extension that watches selected page text and notifies you on each
subsequent change. Chrome 120 or later, Manifest V3. No account, billing, cloud
checks, analytics, or synchronization.

## Load it

```sh
npm ci
npm run build
```

Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and
select this project's `dist/` directory. Pin Page Monitor and click its toolbar
button to open the side panel. After rebuilding, reload the extension on that
page; cancel and restart any active element picker on the target page.

## Use it

1. Open the page and sign in normally if needed.
2. In the side panel, select a region in the current tab. Grant access to that
   site's origin when Chrome asks. Point and click, or use the arrow keys and
   Enter. Escape cancels selection. A CSS selector can also be entered directly.
3. Click **Test selector** to confirm it matches one nonempty region and preview
   the text without saving or sending a notification. Editing the URL or selector
   invalidates that preview. Then set a name, check interval (30 seconds to 24 hours), and duration (up to one
   year) or leave it running until stopped. The default interval is five minutes.
4. Save. The first successful check establishes a baseline without an alert.
   Every later text change creates a desktop notification and increments the badge.
5. The panel opens on your monitors once setup is complete. Use **New monitor**
   to add another, or search and filter by unread changes, attention, or status.
6. Inspect before/after history, mark alerts read, check now, pause/resume, edit,
   or delete a monitor from the side panel. Resuming starts its chosen duration anew.

Existing matching tabs are read without reloading, including tabs in other normal
windows. If several match, a usable tab is preferred,
then an active tab. A loading tab can be read as soon as its selected content exists,
without waiting for unrelated resources. A tab discarded by Chrome Memory Saver
must be opened manually to resume open-tab checks, or closed to allow background
checks; the extension never wakes or reloads it. When no matching tab exists, the
extension first fetches the URL with browser session cookies. If the selected text
is missing, empty, or inside a component/frame absent from that HTML, it uses a
temporary inactive, muted tab to run the site's JavaScript. A desktop alert precedes
the first such check for each monitor, and its card keeps a rendering notice.
If desktop alerts are disabled, the first rendering check stops with an explanation.
Subsequent rendering checks do not repeat the capability alert; content-change
notifications continue normally. Selector previews also alert before rendering.
The temporary tab closes after checking or failure. Selecting it keeps it open.
No existing user tab is reloaded or closed. Clicking a change notification
intentionally opens/focuses its page.

## Support and limits

HTTP and HTTPS HTML pages are eligible, with access requested per origin. The
initial reference site is [Elixir as Infrastructure](https://elixir-as-inf.diviningdad.com/),
whose overview updates live. A useful region is `section[aria-label="Last 15 minutes"]`.

Open tabs expose their rendered DOM. Closed-tab checks try server HTML first and
remember when JavaScript rendering is necessary. Enable **Render JavaScript for
closed-tab checks** when server HTML contains matching placeholder text; automatic
detection cannot distinguish a placeholder from real content. Temporary rendering
waits for page load completion and one second of stable selected text, up to twenty
seconds. This is a bounded heuristic, not proof that every asynchronous update has
finished. Sites that render only in active tabs or take longer may still require an
open tab. HTTP/login errors do not automatically trigger a rendering fallback. Login redirects, request failures, unresolved missing/ambiguous elements,
empty regions, and detected login forms are errors, never changes. The last good
baseline remains intact. Sign in again in a normal tab when a session expires.
Cookie restrictions, site defenses, and site-specific authentication can prevent
checks; universal site/authentication support is not promised. A stale
open page cannot universally reveal that a session expired elsewhere.

The picker supports ordinary HTML text, nested open Shadow DOM (web components),
and same-origin embedded frames in open tabs. Existing CSS selectors still work;
the picker saves a component/frame path when needed. Use **Test selector** to
check either kind before saving. Select text inside a component rather than its
outer container; text extraction does not combine separate shadow trees.

Cross-origin or sandbox-isolated frames, closed shadow roots, image/pixel changes,
input values, PDF viewers, Chrome internal/store pages, and incognito are
unsupported. Supported component and same-origin frame selections use temporary
rendering when the closed page's background HTML cannot provide them. Automatic selector fallback
is deliberately omitted to avoid silently watching the wrong region after a redesign.

Comparison collapses whitespace and excludes script/style, hidden attributes,
form controls, and editable descendants. It is a text comparison, not a screenshot
or full CSS-visibility comparison. Use a small region to avoid incidental timers.

Chrome must remain running and the computer awake to perform checks. Alarms can
be delayed; the interval is a target, not a real-time guarantee. Duration expiry
is enforced before and after a check. Limits bound local storage and work: 20
monitors, 8,000 characters per region, 2 MB fetched HTML, and 10 changes per
monitor. These are safety limits, not paid tiers.

Pending notifications survive worker restarts and retry once a minute, even when
a monitor is paused or expired. Stable notification IDs reduce duplicate UI entries
if Chrome stops the worker during delivery; exactly-once OS notification delivery
is not guaranteed. If retention would evict an undelivered change, checks wait and
show an error until notifications recover. Enable Chrome/system notifications if
needed. Deleting a monitor discards its pending notifications and local history.

## Permissions and privacy

| Permission                        | Purpose                                                                |
| --------------------------------- | ---------------------------------------------------------------------- |
| `sidePanel`                       | Monitor management beside the current page                             |
| `tabs`                            | Identify the current tab when selecting from the persistent side panel |
| Optional HTTP/HTTPS origin access | Read only user-approved sites and fetch monitored URLs                 |
| `scripting`                       | Isolated element picker and text extraction                            |
| `alarms`                          | Scheduled checks and notification recovery                             |
| `storage`                         | Local settings, snapshots, history, and temporary picker state         |
| `offscreen`                       | Parse fetched HTML in a document without executing site code           |
| `notifications`                   | Desktop change alerts                                                  |

No blanket persistent site access, `cookies`, or `unlimitedStorage` permission is
requested. The `tabs` permission exposes tab URLs/titles so the picker can identify
a newly visited site before requesting its origin permission; browsing history is
not recorded. Site grants are origin-scoped (all paths on that site);
checks target the saved URL. User-triggered page loads and checks contact the
monitored site with the browser session. Page content is stored locally, never
sent to a monitoring service. Notifications may display selected text on screen.
No passwords or cookies are copied into extension storage. Delete monitors to
remove their snapshots/history, or uninstall to clear extension data. Temporary tab ownership is kept in session storage with a cleanup alarm, so worker
restarts can close abandoned inactive rendering tabs. Browser-session restarts clear
that ownership; a restored tab is treated as a user tab and is not automatically
closed. Removing a
monitor does not revoke Chrome's origin permission; manage that in extension site
access settings.

## Development and verification

| Command            | Purpose                                                               |
| ------------------ | --------------------------------------------------------------------- |
| `npm run dev`      | Rebuild the extension on source changes                               |
| `npm run build`    | Production extension in `dist/`                                       |
| `npm run verify`   | Typecheck, ESLint, Prettier, unit/integration tests, production build |
| `npm run test:e2e` | Fresh build and isolated Chromium extension tests                     |
| `npm run format`   | Format maintained source and documentation                            |

Install the test browser with `npx playwright install chromium`. Browser tests use
local fixtures and disposable profiles, never your personal session. They block
external page requests and external DNS. See [testing guidance](docs/testing.md)
and [product decisions](docs/product-decisions.md).

The worker is the single storage writer. Changes and pending delivery status are
saved before notifications. Expected errors are surfaced in the side panel;
unknown storage versions are preserved instead of silently reset. The notifier
contract is in `src/background/notifiers.ts`: add an adapter with a stable ID and
an asynchronous `send` method, rejecting failures. New remote channels require an
explicit product/privacy decision and per-channel delivery bookkeeping before shipping.

## Manual release checks

- Open the actual side panel from the toolbar; test narrow widths, keyboard
  navigation, permissions, and the element picker on the selected page.
- Sign into the reference site in the Chrome profile where the unpacked extension
  is loaded. Select its overview section and confirm live changes without reloads.
- Close that tab and check again. Verify the rendering alert appears if necessary,
  the temporary tab stays inactive, and it closes after checking. Select a temporary
  tab and confirm it is retained.
- Sign out and verify that failed checks retain the last good snapshot.
- Check actual OS notification appearance and clicking, which headless tests
  cannot fully establish. Verify paused/duration expiry and browser restart recovery.

No store submission or publication is performed by the build.
