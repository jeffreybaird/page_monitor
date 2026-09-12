# Page Monitor

A local Chrome and desktop Firefox extension that watches selected page text and
notifies you on each subsequent change. Chrome 120+ or Firefox 140+, Manifest V3.
No account, billing, cloud checks, analytics, or synchronization.

## Load it

```sh
npm ci
npm run build
```

Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and
select this project's `dist/` directory. Pin Page Monitor and click its toolbar
button to open the side panel. After rebuilding, reload the extension on that
page; cancel and restart any active element picker on the target page.

### Firefox

```sh
npm run build:firefox
```

Open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and
select `dist-firefox/manifest.json`. Pin Page Monitor in the extensions menu and
click its toolbar button to open the sidebar. After rebuilding, use **Reload** on
that debugging page and restart any active picker. Temporary installation ends
when Firefox closes; permanent installation requires a Mozilla-signed package.

Both browsers share the monitoring logic and UI, but keep separate local data.
Firefox containers and private windows are unsupported: select regions in normal,
non-container tabs using the default Firefox session. If only a container tab
matches a saved URL, checks stop with an explanation rather than reading that
account or silently falling back to the default session. With both types open,
only the normal tab is eligible. Firefox for Android is outside this release.

## Use it

1. Open the page and sign in normally if needed.
2. In the side panel, select a region in the current tab. Grant access to that
   site when the browser asks. Point and click, or use the arrow keys and
   Enter. Escape cancels selection. A CSS selector can also be entered directly.
3. Click **Test selector** to confirm it matches one nonempty region and preview
   the text without saving or sending a notification. Editing the URL or selector
   invalidates that preview. Then set a name, check interval (30 seconds to 24 hours), and duration (up to one
   year) or leave it running until stopped. The default interval is five minutes.
4. Save. The first successful check establishes a baseline without an alert.
   Every later text change creates a desktop notification and increments the badge.
5. The panel opens on your monitors once setup is complete. Use **New monitor**
   to add another, or search and filter by unread changes, attention, or status.
6. Inspect highlighted changes or expand full before/after snapshots. **Current
   text** shows the latest successful reading. Mark alerts read, check now, pause/resume, edit,
   or delete a monitor from the side panel. Resuming starts its chosen duration anew.

Unfinished setup and edits are saved per window for the current browser session.
Reopening the panel restores the form; saving or canceling clears it. Drafts contain
only form fields, not page snapshots, and URLs with embedded credentials are
rejected. Slow checks leave the dashboard responsive, with progress and clear
results. Changing the page, region, or rendering option starts a new baseline and
clears history; the editor explains this before saving.

Existing matching tabs are read without reloading, including tabs in other normal
windows. If several match, a usable tab is preferred,
then an active tab. A loading tab can be read as soon as its selected content exists,
without waiting for unrelated resources. A tab discarded by the browser
must be opened manually to resume open-tab checks, or closed to allow background
checks; the extension never wakes or reloads it. When no matching tab exists, the
extension first fetches the URL with browser session cookies. If the selected text
is missing, empty, or inside a component/frame absent from that HTML, it uses a
temporary inactive, muted tab to run the site's JavaScript. A desktop alert precedes
the first such check for each monitor, and its card keeps a rendering notice.
If the browser reports that desktop alerts are disabled or rejects the notification,
the first rendering check stops with an explanation. Firefox cannot query system
notification permission; a successful notification request does not prove it was
visibly displayed. OS quiet modes can suppress alerts in either browser.
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
input values, PDF viewers, browser internal/store pages, Firefox containers, and private/incognito windows are
unsupported. Supported component and same-origin frame selections use temporary
rendering when the closed page's background HTML cannot provide them. Automatic selector fallback
is deliberately omitted to avoid silently watching the wrong region after a redesign.

Comparison collapses whitespace and excludes script/style, hidden attributes,
form controls, and editable descendants. It is a text comparison, not a screenshot
or full CSS-visibility comparison. Use a small region to avoid incidental timers.

The browser must remain running and the computer awake to perform checks. Alarms can
be delayed; the interval is a target, not a real-time guarantee. Duration expiry
is enforced before and after a check. Limits bound local storage and work: 20
monitors, 8,000 characters per region, 2 MB fetched HTML, and 10 changes per
monitor. These are safety limits, not paid tiers.

Pending notifications survive worker restarts and retry once a minute, even when
a monitor is paused or expired. Stable notification IDs reduce duplicate UI entries
if the browser stops the background context during delivery; exactly-once OS notification delivery
is not guaranteed. If retention would evict an undelivered change, checks wait and
show an error until notifications recover. Enable browser/system notifications if
needed. Deleting a monitor discards its pending notifications and local history.

## Permissions and privacy

| Permission                        | Purpose                                                                |
| --------------------------------- | ---------------------------------------------------------------------- |
| `sidePanel` (Chrome only)         | Monitor management beside the current page                             |
| `tabs`                            | Identify the current tab when selecting from the persistent side panel |
| Optional HTTP/HTTPS origin access | Read only user-approved sites and fetch monitored URLs                 |
| `scripting`                       | Isolated element picker and text extraction                            |
| `alarms`                          | Scheduled checks and notification recovery                             |
| `storage`                         | Local settings, snapshots, history, and temporary picker state         |
| `offscreen` (Chrome only)         | Parse fetched HTML in a document without executing site code           |
| `notifications`                   | Desktop change alerts                                                  |

No blanket persistent site access, `cookies`, or `unlimitedStorage` permission is
requested. The `tabs` permission exposes tab URLs/titles so the picker can identify
a newly visited site before requesting its origin permission; browsing history is
not recorded. Chrome retains its existing origin grant requests. Firefox host grants cover
all paths and ports for the selected scheme and hostname because Firefox match
patterns cannot restrict ports. Checks and picker authorization still target the
saved complete URL and exact origin where relevant. User-triggered page loads and checks contact the
monitored site with the browser session. Page content is stored locally, never
sent to a monitoring service. Notifications may display selected text on screen.
No passwords or cookies are copied into extension storage. Delete monitors to
remove their snapshots/history, or uninstall to clear extension data. Temporary tab ownership is kept in session storage with a cleanup alarm, so worker
restarts can close abandoned inactive rendering tabs. Browser-session restarts clear
that ownership; a restored tab is treated as a user tab and is not automatically
closed. Removing a
monitor does not revoke the browser's site permission; manage that in extension site
access settings.

Firefox uses its built-in sidebar and a non-persistent background document, so it
does not request `sidePanel` or `offscreen`. Session storage is restricted to
trusted extension contexts in both browsers. Chrome also restricts local storage;
Firefox has no equivalent local-storage access-control API, so the extension's
own isolated content scripts can technically access it. The picker does not read
saved monitor data, and ordinary page scripts cannot access extension storage.
The Firefox manifest declares no collection or transmission to an external service.

## Development and verification

| Command                    | Purpose                                                          |
| -------------------------- | ---------------------------------------------------------------- |
| `npm run dev`              | Watch/rebuild Chrome                                             |
| `npm run dev:firefox`      | Watch/rebuild Firefox                                            |
| `npm run build`            | Chrome production extension in `dist/`                           |
| `npm run build:firefox`    | Firefox production extension in `dist-firefox/`                  |
| `npm run verify`           | Typecheck, ESLint, Prettier, unit/integration tests, both builds |
| `npm run test:e2e`         | Fresh Chrome build and isolated Chromium extension tests         |
| `npm run test:e2e:firefox` | Fresh Firefox build and isolated geckodriver extension tests     |
| `npm run lint:firefox`     | Mozilla package validation; reviewed warnings documented below   |
| `npm run package:firefox`  | Unsigned Firefox ZIP in `artifacts/firefox/`                     |
| `npm run format`           | Format maintained source and documentation                       |

Install the test browser with `npx playwright install chromium`. Browser tests use
local fixtures and disposable profiles, never your personal session. They block
external page requests and external DNS. See [testing guidance](docs/testing.md)
and [product decisions](docs/product-decisions.md).

The background context is the single storage writer. Changes and pending delivery status are
saved before notifications. Expected errors are surfaced in the side panel;
unknown storage versions are preserved instead of silently reset. The notifier
contract is in `src/background/notifiers.ts`: add an adapter with a stable ID and
an asynchronous `send` method, rejecting failures. New remote channels require an
explicit product/privacy decision and per-channel delivery bookkeeping before shipping.

## Manual release checks

- Open the actual side panel from the toolbar; test narrow widths, keyboard
  navigation, permissions, and the element picker on the selected page.
- Sign into the reference site in each browser profile where the development
  extension is loaded. Select its overview section and confirm live changes without reloads.
- Close that tab and check again. Verify the rendering alert appears if necessary,
  the temporary tab stays inactive, and it closes after checking. Select a temporary
  tab and confirm it is retained.
- Sign out and verify that failed checks retain the last good snapshot.
- Check actual OS notification appearance and clicking, which headless tests
  cannot fully establish. Verify paused/duration expiry and browser restart recovery.

No store submission or publication is performed by the build.

“Current text” displays a formatted HTML snapshot of the selected region from the
latest successful check. Headings, emphasis, lists, and tables are retained; scripts,
forms, external resources, and site CSS are excluded. Images use their alternative
text. Change notifications still compare text. Existing monitors gain HTML after
the next successful check; oversized markup falls back to text. Each monitor stores
at most 64,000 HTML characters locally, alongside its text snapshot.

### Firefox tooling and validation notes

Install stock Firefox 140+ and [geckodriver](https://github.com/mozilla/geckodriver/releases),
then run `npm run test:e2e:firefox`. The harness uses a disposable profile, native
WebDriver extension installation, and local fixtures. Set `GECKODRIVER` and
`FIREFOX_BINARY` to executable paths if they are not discoverable. For example,
macOS Firefox is `/Applications/Firefox.app/Contents/MacOS/firefox`. `HEADLESS=0`
shows the disposable browser. No test-only privileged messages are packaged.

`web-ext lint` currently reports three reviewed warnings: two dynamic `innerHTML`
assignments in the existing HTML preview (inert template parsing followed by the
allowlist sanitizer, covered by malicious-markup tests), and an Android minimum
version warning for data collection declarations. Android is not a supported or
enabled distribution target; desktop Firefox supports the declaration from 140.
Do not treat these warnings as an unqualified clean validator result.

The development-only `web-ext` dependency currently pulls `image-size` 2.0.2,
which has denial-of-service advisories GHSA-w3rx-r6r6-pgpr and
GHSA-5p2g-fcmc-qvqq for crafted ICNS/JXL/HEIF files. Our validator only processes
repository-controlled extension assets (PNG); none of this tooling ships in the
extension. There is no compatible patched version reported by the current audit.
Recheck before releases; do not process untrusted image packages with this toolchain.

`npm run package:firefox` creates an unsigned artifact only. Mozilla signing and
store submission are separate release actions; never include signing credentials
in the manifest, source tree, or archive.
