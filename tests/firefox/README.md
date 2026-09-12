# Firefox browser integration

The Firefox harness is `scripts/test-firefox.mjs`. It drives stock Firefox with
Mozilla's geckodriver using the WebDriver HTTP API. Playwright's extension loader
only supports Chromium, so this harness does not use Playwright's patched Firefox.

Install [geckodriver](https://github.com/mozilla/geckodriver/releases) and Firefox,
then run `npm run test:e2e:firefox`. Use `GECKODRIVER=/absolute/path/to/geckodriver` and
`FIREFOX_BINARY=/absolute/path/to/firefox` to select executables. `HEADLESS=0` shows
the disposable test browser. The script itself expects a fresh `dist-firefox/`
build; the npm script builds before running it.

Each run installs the actual built extension as a temporary addon in a new profile.
Fixture HTTP traffic stays on loopback. Before extension initialization, Firefox's
HTTP/HTTPS proxy points non-loopback requests at a local rejecting proxy. No real
provider credentials, personal profiles, production test hooks, or live dashboards
are used. Native browser privileges (`--allow-system-access`) seed only the fixture
host permission, reload/stop the test extension, and pin its toolbar button in the
disposable profile. The profile is deleted afterward. Driver diagnostics remain in
`test-results/firefox-geckodriver.log`, including on failure.

The suite checks:

- Authenticated background reads after closing the site, change history, badges,
  and baseline preservation after login expiry.
- Inert HTML parsing without image/script subresource requests.
- Live-tab extraction without a network reload, repeated picker injection, and
  a real page click updating the editor selector.
- Content-script attempts to delete monitors rejected without state changes.
- JavaScript rendering through a temporary tab and subsequent tab cleanup.
- Malformed requests and revoked host access, including no unauthorized requests.
- Extension reload preserving saved monitors and snapshots.
- A scheduled alarm waking a stopped background event page and persisting a check.
- A real toolbar-button click opening the native Firefox sidebar.

Native permission prompt approval/denial and the Pick button's first-use gesture
still require a manual check. Permission setup for automated monitoring cases uses
Firefox's native permission manager, rather than claiming to test that prompt.
The nested remote sidebar frame cannot currently be targeted through this harness's
WebDriver frame commands. The automated picker case invokes the production request
from the extension page, then clicks the selected element in a real site tab.

Also manually check OS-visible notifications (WebExtensions notification success
and badges cannot prove OS presentation), container/private-tab rejection, and
activated temporary tabs being preserved. Automated coverage is representative;
it does not duplicate all existing Chrome and unit-test cases.

References: [geckodriver usage](https://firefox-source-docs.mozilla.org/testing/geckodriver/Usage.html),
[system-access flag](https://firefox-source-docs.mozilla.org/testing/geckodriver/Flags.html),
[Playwright extension guide](https://playwright.dev/docs/chrome-extensions).
