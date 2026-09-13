# Submission preparation

For the complete ordered procedure, use [Package and submit Page Monitor](submit.md).

This folder contains store descriptions, privacy-policy draft, permission answers,
reviewer instructions and reproducible packaging instructions for Chrome and
Firefox. Creating these files and ZIPs does not upload, publish or submit an item.

## Build the handoff

```sh
npm ci
npm run verify
npm run test:e2e
GECKODRIVER=/path/to/geckodriver npm run test:e2e:firefox
npm run lint:firefox
npm run submission:assets
npm run package:submission
```

Candidate ZIPs, source ZIP, checksums, readiness report and store artwork live in
`artifacts/submission/packages/`; artwork is in `artifacts/submission/assets/`. Candidate filenames say `candidate`; they are for review,
not a claim of readiness. After finishing the items below, `npm run package:release`
fails unless required configuration and recorded manual checks are present.

## Publisher items still needed

- Registered ExtensionPay product ID with exactly one USD $2.99 one-time plan;
  set `VITE_EXTPAY_EXTENSION_ID` as described in `../payments.md`.
- Verify actual purchase, restoration, offline access and unpaid/refund behavior on
  production/signed installs. Supply paid-feature reviewer access privately.
- Verify native Firefox licensing consent (allow, deny and revoke). Record both
  manual checks in `release.json`; do not mark them true based on mocked tests.
- Approve the publisher/privacy contact, publish the completed privacy policy on
  public HTTPS, and set the policy and monitored support URLs in `release.json`.
- Choose the application distribution license and add `LICENSE`. ExtPay's upstream
  LICENSE is LGPL-3.0 despite stale AGPL metadata; this does not require assigning
  AGPL to the whole app on that basis. Preserve the shipped notices and provide the
  library source/rebuild materials with distribution.
- Arrange public access to the appropriate source/rebuild materials: the current
  GitHub repository is **private** (verified September 12, 2026). An internal
  repository URL is not a public source offer or support URL. Set
  `sourceAvailabilityUrl` to the public source/rebuild download. This task does not
  change repository visibility.
- Review the final images/listing, create or sign into developer accounts, complete
  publisher verification and required store declarations. Choose territories and
  distribution settings. No developer credentials or payment details are stored here.

## Included documents

- `store-listing.md`: shared copy and browser-specific endings.
- `privacy-policy.md`: factual policy draft; contact/publication still required.
- `privacy-fields.md`: data categories and every permission justification.
- `reviewer-notes.md`: local fixture walkthrough and private paid-access reminder.
- `build.md`: ZIP contents, source reproduction and library replacement instructions.
- `release.json`: public URLs and manual-check attestations, initially empty/false.

## Release verification boundaries

Automated tests use local fixtures and simulated payment responses. They do not
prove actual charging, signed Firefox checkout, native data consent, or store
approval. Existing Mozilla lint warnings and development-dependency audit findings
are recorded in `../testing.md`; no warnings have been suppressed.

The version remains 0.1.0 for this first submission preparation. The Firefox add-on
ID remains `page-monitor@local`; it is a stable identifier, not a network endpoint.
Keep it for updates once submitted. If you want a different ID, choose it before
first submission because changing it creates a different add-on identity.

## Verification recorded September 12, 2026

- `npm run verify`: 133 tests plus typecheck, lint, formatting and Chrome/Firefox
  production builds passed.
- `npm run test:e2e`: all 23 Chromium journeys passed on the full run.
- Firefox 155.0.1 integration suite passed with geckodriver; Mozilla lint returned
  zero errors and three previously documented warnings.
- Candidate packaging and ZIP integrity/checksums passed. The source ZIP was
  extracted into a fresh temporary directory, installed using `npm ci --offline`,
  and built for both browsers. All packaged files except the separately generated
  `BUILD-INFO.json` reproduced byte-for-byte.
- Store PNGs were rendered and visually inspected: three 1280×800 screenshots,
  one 440×280 promotional image and the existing 128×128 icon.
- `package:release` was checked to fail before building while publisher prerequisites
  remain missing. No live provider or store-account action was performed.
