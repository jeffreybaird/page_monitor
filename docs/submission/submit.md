# Package and submit Page Monitor

These steps use this repository's scripts. They cover Chrome Web Store and desktop
Firefox / AMO. Run commands from the repository root. Packaging is local; uploading,
submitting for review, and publishing are separate actions.

Current version: **0.1.0**. Existing ZIPs are candidates. Payment configuration,
public URLs, the application license and manual release checks are still incomplete.

## 1. Prepare the developer accounts

1. Register or sign in to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
   Complete the registration fee, account verification, contact details and required
   two-step verification shown by Google. See [Google's registration guide](https://developer.chrome.com/docs/webstore/register).
2. Sign in to the [Mozilla Add-ons Developer Hub](https://addons.mozilla.org/developers/)
   with a Mozilla Account. Complete the developer agreement and account requirements.
3. Use accounts and contact addresses you will retain for future updates. Store
   notices and review questions go to these accounts.

## 2. Configure the payment product

1. Register Page Monitor in [ExtensionPay](https://extensionpay.com/) and connect
   your Stripe account.
2. Configure **exactly one active plan: USD 2.99, one-time payment**. The extension
   refuses checkout if the provider returns a different price or multiple plans.
3. Enable purchase restoration for customers who reinstall or change browsers.
4. Create `.env.local` at the repository root. Set its public product ID:

   ```dotenv
   VITE_EXTPAY_EXTENSION_ID=page-monitor
   ```

   This is ExtensionPay's product ID, not the Chrome extension ID, Firefox add-on
   ID, Stripe secret, or an API credential. Do not place secret keys in `VITE_`
   variables: those values can be bundled into the extension.

5. Use the same product for both browsers if the license is meant to be shared.
   The build supports different mode-specific IDs if you deliberately configure
   separate products; see [build configuration](build.md).

## 3. Complete the public documents

1. Use the reviewed [privacy policy](privacy-policy.md), which includes Jeffrey
   Baird’s contact details. Keep those details current.
2. Publish it at `https://jeffreybaird.com/products/page-monitor`. Verify it loads
   in a signed-out browser.
3. Verify `https://jeffreybaird.com/contact` loads and provides a working contact route.
4. Review the approved source-available terms in the root `LICENSE` file.
   Preserve `public/THIRD-PARTY-NOTICES.txt` and `public/licenses/`. ExtPay's upstream
   LICENSE is LGPL despite stale AGPL package metadata; see [payment notes](../payments.md).
5. Provide public access to the corresponding source/rebuild materials. The repository
   `https://github.com/jeffreybaird/page_monitor` is public. Keep the source and
   rebuild instructions for each distributed version available.
6. Fill in [release.json](release.json):

   ```json
   {
     "privacyUrl": "https://jeffreybaird.com/products/page-monitor",
     "supportUrl": "https://jeffreybaird.com/contact",
     "sourceAvailabilityUrl": "https://github.com/jeffreybaird/page_monitor",
     "livePaymentsVerified": false,
     "firefoxConsentVerified": false,
     "privacyPolicyPublished": false
   }
   ```

   Verify these configured URLs load publicly. Keep the verification flags
   false until you have performed the checks below. The packaging script checks
   configuration, not the contents of those pages or the truth of those flags.

## 4. Install dependencies and run checks

1. Install Node/npm compatible with the toolchain. The existing build's exact
   versions are in `artifacts/submission/packages/report.json`; subsequent builds
   record their versions there and in `BUILD-INFO.json`. Git, `zip` and `unzip`
   must also be available.
2. Install the locked dependencies and Chromium test browser:

   ```sh
   npm ci
   npx playwright install chromium
   ```

3. Run the verification gate and Chrome integration tests:

   ```sh
   npm run verify
   VITE_EXTPAY_EXTENSION_ID='' npm run test:e2e
   ```

   The explicit empty ID keeps the general browser fixtures on the free plan.
   The separate payment journey builds its own configured test extension and
   stubs provider responses. This does not erase `.env.local`.

4. Install Firefox and geckodriver, then run Firefox integration tests and validation:

   ```sh
   GECKODRIVER=/absolute/path/to/geckodriver npm run test:e2e:firefox
   npm run lint:firefox
   ```

   Set `FIREFOX_BINARY` as well if the harness cannot find Firefox. Do not rely on
   `/private/tmp/geckodriver` remaining installed from an earlier session.

5. Investigate failures. Existing Mozilla warnings are documented in
   [reviewer-notes.md](reviewer-notes.md); successful lint is not store approval.

## 5. Build candidates and test the release behavior

1. Generate store artwork:

   ```sh
   npm run submission:assets
   ```

   Inspect all images in `artifacts/submission/assets/`. They use actual compiled
   UI with synthetic build-dashboard data. The temporary demo payment ID is not
   used in the extension ZIPs.

2. Review `git status`. Stage new application files, scripts and submission docs
   that should be included. Packaging uses tracked paths and their current contents;
   untracked files are omitted. Keep `.env.local` and credentials out of Git.
3. Build the candidate packages:

   ```sh
   npm run package:submission
   ```

4. Inspect `artifacts/submission/packages/report.json`. Candidates always say
   `ready: false`; check the listed blockers and resolved product IDs.
5. For Chrome local testing, open `chrome://extensions`, enable Developer mode,
   choose **Load unpacked**, and select `dist/`.
6. For Firefox temporary testing, open `about:debugging#/runtime/this-firefox`,
   choose **Load Temporary Add-on**, and select `dist-firefox/manifest.json`.
7. Verify free limits, selector errors, check results, pause/resume, notifications
   and closed-tab JavaScript rendering. Use [reviewer-notes.md](reviewer-notes.md)
   for a deterministic local HTML fixture.
8. Test purchase and restore using the configured provider. Verify the resulting
   license, offline access, and unpaid/refund behavior. Unpacked/temporary builds
   can use provider development mode; a simulated or development payment does not
   prove production charging.
9. Verify Firefox's licensing-data consent: allow, deny and revoke. Confirm denial
   prevents provider requests and the free features remain usable.
10. For first-release production testing, use the stores' controlled testing or
    signing channels before a public launch. Chrome provides restricted visibility;
    Mozilla supports unlisted signing. These involve actual uploads/review and are
    separate from local packaging. Use candidate ZIPs deliberately for that testing,
    supply reviewer access, and keep the add-on identities stable. See
    [Chrome distribution](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution)
    and [Firefox distribution/signing](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/).
    If those uploads consume version 0.1.0, increment the version before the next
    upload as described in step 10 below.
11. Set `livePaymentsVerified` and `firefoxConsentVerified` to true only after the
    corresponding checks. Set `privacyPolicyPublished` to true after checking the
    published policy. Do not set flags merely to get a release ZIP.

## 6. Generate the final packages

1. Resolve all items in [readiness.md](readiness.md). Commit the reviewed source
   where possible so the archive has an identifiable revision. The earlier commit
   attempt was blocked by the 1Password SSH signing agent; unlock/reconnect it if
   that problem remains. No signing settings need to be changed.
2. Run:

   ```sh
   npm run package:release
   ```

3. Check that `report.json` has `mode: "release"`, `ready: true`, the intended
   version and product IDs, and a current timestamp. A failed run leaves the
   previous package set in place, so do not mistake an old report for success.
4. For version 0.1.0, use these files:

   | File under `artifacts/submission/packages/` | Purpose                                           |
   | ------------------------------------------- | ------------------------------------------------- |
   | `page-monitor-0.1.0-chrome.zip`             | Chrome Web Store package                          |
   | `page-monitor-0.1.0-firefox.zip`            | Firefox package                                   |
   | `page-monitor-0.1.0-source.zip`             | AMO source review and source/rebuild distribution |
   | `SHA256SUMS`                                | Archive checksums                                 |
   | `report.json`                               | Build metadata and prerequisites                  |

5. Verify checksums on macOS:

   ```sh
   cd artifacts/submission/packages
   shasum -a 256 -c SHA256SUMS
   cd ../../..
   ```

6. Update the public source-download page with the matching source ZIP and its
   rebuild instructions. Retain a copy of the complete release set outside the
   generated directory: the next packaging run replaces `packages/`.

Do not upload the repository, `dist/` as an enclosing folder, a `.crx` produced by
Chrome's local packer, or the source ZIP as the runtime extension. The packaging
script puts `manifest.json` at the root of each browser ZIP.

## 7. Submit to Chrome Web Store

1. Open the [Developer Dashboard](https://chrome.google.com/webstore/devconsole).
2. For a first listing choose **Add new item**, then upload the Chrome ZIP from
   step 6. For an existing testing/listed item, open that item and upload a new
   package/version there; do not create a second listing.
3. In **Store Listing**, use [store-listing.md](store-listing.md), including the
   Chrome-specific ending. Use the technical description and state the free limits
   and $2.99 optional lifetime purchase.
4. Upload `icon-128.png`, `promo-440x280.png`, and the three numbered screenshots
   from `artifacts/submission/assets/`. Add the public support and privacy URLs.
5. In **Privacy**, use [privacy-fields.md](privacy-fields.md) for the single-purpose
   statement, permission justifications, data categories and remote-code answer.
   Review each answer before certification; locally stored page content still
   needs disclosure.
6. In **Distribution**, choose territories and visibility. The extension is a free
   download with an external optional purchase; disclose that purchase in the
   applicable fields. Chrome does not process this $2.99 license payment.
7. In **Test instructions**, paste the relevant [reviewer notes](reviewer-notes.md).
   Supply working paid-feature review access through this private field. Do not
   put tokens or credentials in the public description or source ZIP.
8. Save and resolve dashboard errors. Click **Submit for Review** when ready.
9. If you want to inspect the approved release before launch, select deferred/manual
   publishing instead of immediate publication after approval. Monitor the dashboard
   and review emails, then publish the approved item when ready.

Official workflow: [Chrome publishing](https://developer.chrome.com/docs/webstore/publish).
Artwork specifications: [Chrome images](https://developer.chrome.com/docs/webstore/images).

## 8. Submit to Firefox / AMO

1. Open the [Add-ons Developer Hub](https://addons.mozilla.org/developers/).
2. For a first public listing choose **Submit a New Add-on** → **On this site**.
   If you already registered this add-on during signing/testing, manage that existing
   add-on and add a listed version instead of creating a new identity.
3. Upload `page-monitor-0.1.0-firefox.zip` (or the current version's Firefox ZIP).
   Resolve validator errors. Read warnings and include explanations where needed.
4. Select the intended desktop platforms. Do not claim Firefox Android support.
5. When asked for source code, choose **Yes** and upload the matching source ZIP.
   The extension is bundled/minified, so reviewers need the source and exact build
   instructions. `REBUILD.md` and `BUILD-INFO.json` are included.
6. Fill the name, summary, description, category, support contact and privacy policy
   using the prepared documents. Use the Firefox-specific ending and disclose the
   container/private-window limitations.
7. Mark that the add-on requires payment for some functionality. State the free
   limits and the one-time price; the free features require no account.
8. Provide the approved application license and the required reviewer information.
   Include paid-feature access privately. Upload the icon and relevant screenshots
   in the listing media fields.
9. Review the final submission and complete AMO's submission action. Monitor review
   messages and respond with reproducible details. Mozilla handles signing; do not
   try to sign the Firefox ZIP yourself.
10. After approval/publication, install the signed store version and repeat the
    install, notification, purchase and restore smoke checks.

Official workflow: [AMO submission](https://extensionworkshop.com/documentation/publish/submitting-an-add-on/).
Source requirements: [AMO source code](https://extensionworkshop.com/documentation/publish/source-code-submission/).

## 9. Retain the release record

Save the store item URLs/IDs, source commit, product ID, submitted ZIPs, source ZIP,
checksums, listing copy and review correspondence. Keep credentials separately.
Test the installed public versions, not only unpacked builds. If you replace a
rejected package, rebuild and provide the matching source archive again.

## 10. Subsequent versions

1. Update the version in `package.json`, the lockfile and `public/manifest.json`.
   `npm version patch --no-git-tag-version` updates the npm files; update the
   manifest to the same value. Both browser builds use that manifest version.
2. Keep the existing Chrome listing and Firefox add-on ID (`page-monitor@local`).
3. Re-run verification, relevant manual checks, artwork generation if the UI changed,
   and release packaging. Update disclosures if data handling or permissions changed.
4. Upload to the existing store items with the matching source ZIP for AMO.
   Store review and publication are still separate from a Git push.

Guide checked against repository scripts and official store documentation on
September 13, 2026. Dashboard labels may change; follow their equivalent current
fields rather than skipping a required declaration.
