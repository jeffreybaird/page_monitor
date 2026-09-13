# Submission builds

Packaging prepares local archives. It does not upload or publish an extension.

Use the Node and npm versions recorded in the generated `BUILD-INFO.json`.
Install the committed dependencies with `npm ci`. The packaging script also needs
Git, `zip`, and `unzip` on PATH (available on macOS; install them on Linux).

## Configuration

Set `VITE_EXTPAY_EXTENSION_ID` to the public ExtensionPay product ID. This is not
an API key. Vite resolves Chrome configuration in `production` mode and Firefox
configuration in `firefox` mode, including the usual `.env` precedence and shell
environment overrides. The script explicitly passes each resolved ID to its build.
No environment files or other environment variables are copied into the source ZIP.

The repository must contain a project `LICENSE` permitting the intended
distribution. Set real, publicly accessible HTTPS URLs in
`docs/submission/release.json`:

```json
{
  "privacyUrl": "https://your-domain.com/privacy",
  "supportUrl": "https://your-domain.com/support",
  "sourceAvailabilityUrl": "https://your-domain.com/source",
  "livePaymentsVerified": false,
  "firefoxConsentVerified": false,
  "privacyPolicyPublished": false
}
```

Replace these examples with actual published pages. The script checks URL syntax
and rejects common local/example hosts; manually verify that all three pages load and
contain the promised information. `sourceAvailabilityUrl` must provide public
access to the corresponding source archive and rebuild instructions; a private
repository URL is insufficient. Publish and verify this source offer before release. The existence of a license file does not prove
that dependency obligations are satisfied: review the submission checklist.

## Prepare archives

Run the required verification and browser checks documented in the repository
before packaging. Stage new source, assets, scripts, and submission documentation
in Git so the source ZIP includes them; it uses tracked paths and their current
working tree contents, not just the last commit.

```sh
node scripts/package-submission.mjs
```

This creates explicitly named **candidate** archives, even when configuration is
complete. Candidates always report `ready: false`. Missing release inputs are
listed in `artifacts/submission/packages/report.json` and printed after packaging. A
candidate without a product ID cannot complete paid purchase flows.

After resolving configuration and submission blockers:

```sh
node scripts/package-submission.mjs --release
```

Release mode fails before builds if a product ID, project license, public privacy
URL, public support URL, public source availability URL, required manual attestation, or required tracked packaging
file is missing. A release
report's `ready: true` means these packaging prerequisites passed; store account
configuration, payment testing, policy review, and approval are separate checks.

Both modes remove the respective build directory before running `npm run build`
and `npm run build:firefox`. They create fresh ZIPs with `manifest.json` at the
archive root and verify manifest entry points, matching versions, exact archive
contents, and ZIP integrity. Completed runs replace `artifacts/submission/packages/` with:

- Chrome ZIP, containing the fresh Chrome build and `BUILD-INFO.json`.
- Firefox ZIP, containing the fresh Firefox build and `BUILD-INFO.json`.
- Source ZIP for AMO, with rebuild instructions and `BUILD-INFO.json`.
- `SHA256SUMS`, containing SHA-256 checksums for all three ZIPs.
- `report.json`, containing prerequisites, tool versions, product IDs, source
  commit, working-tree status, and archive checksums.

Only `artifacts/submission/packages/` is replaced; sibling artwork under
`artifacts/submission/assets/` is preserved.

Temporary staging is removed whether packaging succeeds or fails. Failed runs do
not replace a previous completed artifact set; check the report's timestamp and
mode before using any existing archives.

## Rebuild the submitted source

Extract the source ZIP into an empty directory. Follow its generated `REBUILD.md`,
which records the exact public product ID for each browser, plus the Node/npm
versions. Run `npm ci`, then the two commands listed there. Compare application
assets in `dist/` and `dist-firefox/` with the corresponding submitted ZIP.
`BUILD-INFO.json` is appended by packaging and is not a compiler output.

The source archive includes tracked application files under `src/`, `public/`,
`scripts/`, `docs/`, and `tests/`, plus explicitly named root build configuration,
HTML entry points, package/lock files, README, and LICENSE. Dotfiles, Git metadata,
agent instructions/configuration, dependency directories, and credential/key
filenames are excluded. Keep secrets out of application source and documentation;
filename filtering cannot detect secrets embedded in an otherwise permitted file.
Untracked files are not included. The working-tree flag records whether the
packaged content may differ from the reported commit.

## Manual release attestations

The release configuration also requires these explicit boolean fields. Set them
only after completing the corresponding review; an unset or false value blocks
`--release` before building:

- `livePaymentsVerified`: verified real $2.99 lifetime checkout, paid activation,
  and license restoration with the configured ExtensionPay product.
- `firefoxConsentVerified`: verified Firefox payment consent, denial, and accepted
  purchase/restore flows in the intended release build.
- `privacyPolicyPublished`: verified the configured public privacy policy loads
  and accurately describes the current release and optional payment data flow.

The report records these as `attestations`. They are human assertions, not tests
performed by the packaging script. A successful release package does not signify
store approval or publication.

## Included library source and replacement

The source ZIP also includes the exact installed, unminified library input files
used by the build, with their installed LICENSE and package metadata:

- `third-party/extpay/ExtPay.module.js`
- `third-party/webextension-polyfill/browser-polyfill.js`

After `npm ci`, copy the included files back to the installed dependency locations
before building. These commands also support rebuilding with your modified copies:

```sh
cp third-party/extpay/ExtPay.module.js node_modules/extpay/dist/ExtPay.module.js
cp third-party/webextension-polyfill/browser-polyfill.js node_modules/webextension-polyfill/dist/browser-polyfill.js
```

Then run the exact product-ID build commands in the generated `REBUILD.md`.
The Vite configuration applies documented privacy and timeout adaptations to
ExtPay during bundling. Its replacement-count checks intentionally fail if a
modified library changes the expected source patterns; review and adapt those
checks when deliberately replacing the library. Public third-party notices and
full license texts are included with the application assets. Dependency package
metadata is preserved verbatim, including stale upstream license labels; consult
the packaged notices for the applicable license assessment.
