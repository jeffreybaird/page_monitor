# Firefox optional licensing consent verification

Verified on September 13, 2026 with stock Firefox 155.0.1 on macOS and
geckodriver 0.36.0. The final command completed successfully:

```sh
GECKODRIVER=/private/tmp/geckodriver \
FIREFOX_BINARY=/Applications/Firefox.app/Contents/MacOS/firefox \
node scripts/test-firefox-consent.mjs
```

The script builds the production Firefox entry points into a private temporary
directory with the non-live product ID `page-monitor-consent-fixture`. It installs
that directory as a temporary add-on in a disposable Firefox profile. It does not
modify the regular build directories, release configuration, browser profiles,
application code, or permission implementations.

## Results

| Check                           | Evidence                                                                                                                                                                                                                                                                                                                                       | Result |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| First-use purchase denial       | WebDriver clicks the actual **Buy lifetime · $2.99** button. Firefox displays its native data collection prompt. A native pointer click on **Deny** produces the extension's denied status. `permissions.getAll()` remains empty for data collection, no provider request reaches the rejecting proxy, and no additional browser window opens. | Passed |
| First-use restoration allowance | WebDriver clicks the actual **Restore purchase** button and the native **Allow** control. Firefox grants `authenticationInfo`, `personallyIdentifyingInfo`, and `financialAndPaymentInfo`. The proxy then observes and rejects provider contact.                                                                                               | Passed |
| Revocation                      | The harness removes those actual grants using Firefox's `permissions.remove()`. `permissions.getAll()` confirms removal. Purchase, restoration, and license refresh messages through the production worker each return the licensing-access error without another provider request. Paid status remains false.                                 | Passed |

The runner emitted:

```text
Firefox 155.0.1
PASS native deny leaves no data grants, provider request, or checkout window
PASS native allow grants all three data categories
PASS real permission revocation rejects purchase, restore, refresh before provider contact
```

`npx eslint scripts/test-firefox-consent.mjs` and the targeted Prettier check passed.
The latest driver diagnostic log is generated at
`test-results/firefox-consent-geckodriver.log`.

## What is native, and what remains unverified

The request originates from the shipped button's handler using a WebDriver user
gesture. Firefox's actual notification UI and permission store are exercised.
Native controls use WebDriver pointer actions at observed button coordinates;
Marionette's element-click command incorrectly treated these popup controls as
offscreen. No prompt callback, permissions grant, or provider response is mocked.
Revocation uses the real extension API rather than the Add-ons Manager UI.

The extension page is opened in a normal tab for this focused consent test. This
does not independently prove sidebar toolbar behavior. The add-on is unsigned and
temporarily installed; signed installation and the live configured product remain
separate checks. Firefox 140 predates this optional consent API and is not the
target of this native-prompt test.

A rejecting loopback HTTP/HTTPS proxy is configured before browser startup, with
direct fallback disabled. Non-loopback requests cannot reach ExtensionPay or
Stripe. No email, card, real purchase, or live license verification is used. The
allowed restoration attempt therefore cannot demonstrate successful restoration.

Do not set `firefoxConsentVerified` in the release configuration from this result
alone. Complete the signed, real-product checkout and restoration verification
before claiming the full submission check is complete.

## Platform references

- [Mozilla permissions.request documentation](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/permissions/request)
  documents the user-gesture requirement and optional data collection requests.
- [Playwright extension guide](https://playwright.dev/docs/chrome-extensions)
  covers Chromium extension support; this Firefox test uses stock Firefox and
  geckodriver instead.
