# Testing a Chrome Extension

Read this when configuring test infrastructure or working on browser integration tests.
The root AGENTS.md defines the required testing principles; this file supplies implementation
guidance. Apply sections relevant to the behavior under test.

### Test layout and tool ladder

Prefer the existing layout. For new infrastructure, group tests by responsibility:
`tests/unit/`, `tests/integration/`, `tests/e2e/`, `tests/fixtures/`, and `tests/support/`.
Keep Vitest and Playwright discovery separate so neither runner collects the other's tests.
Share typed fixture builders and contract helpers, not mutable state or oversized setup files.

| Behavior                                                           | Default test                                    | What it establishes                                   |
| ------------------------------------------------------------------ | ----------------------------------------------- | ----------------------------------------------------- |
| Validation, calculations, policies, state transitions              | Vitest unit test                                | Domain outcomes and boundary cases                    |
| Use-case orchestration                                             | Vitest with injected adapters                   | Success, declared failures, and side-effect decisions |
| Storage, migrations, and network clients                           | Integration test                                | Persistence/protocol contracts and error mapping      |
| Message handlers                                                   | Integration test with realistic sender fixtures | Runtime validation, authorization, and response shape |
| Simple presentation and DOM extraction                             | DOM-environment test with fixtures              | Rendering, events, and supported page structures      |
| Chrome API behavior, injection, cross-context messaging, lifecycle | Playwright with the built extension             | Actual browser integration                            |
| Layout, focus, keyboard journeys, visual regressions               | Browser test plus targeted inspection           | Behavior a simulated DOM cannot establish             |

Use the lowest-cost layer that proves the behavior. Extension plumbing itself is browser
behavior: do not postpone all browser coverage until a feature has complex UI. Avoid repeating
every domain edge case in E2E; keep representative end-to-end journeys and boundary coverage.
A DOM emulator or fake IndexedDB is useful but is not proof of Chrome integration.

### Isolation and fixtures

- Create fresh typed objects with fixture-builder functions and explicit overrides. Prefer
  in-memory inputs for domain tests; persist only when persistence is part of the contract.
  No factory library is required. Keep IDs, timestamps, and randomized inputs deterministic.
- Reset mocks, fake timers, listeners, and in-memory stores between tests. Restore patched
  globals after each test. Inject clocks/ID generators when they affect observable behavior.
- Give independent browser tests isolated temporary profiles, or implement and verify complete
  cleanup when sharing a profile. Do not share writable profiles across parallel workers or use
  a developer's personal profile. Dispose of contexts and local servers even on failure.
- Use disposable storage for adapter tests. Test fresh initialization and migrations from
  supported old schemas, including repeat execution. A transaction rollback in one test process
  does not isolate storage used by an independent browser context.
- Seed unrelated browser tests through narrow fixture helpers; test the real onboarding or
  authentication flow separately when it exists. Do not bypass the permission or message
  boundary that the test claims to verify.
- Wait for explicit events or observable outcomes using bounded waits. Do not use arbitrary
  sleeps or retries to hide race conditions. Fake timers do not simulate Chrome worker suspension.

### External services: no live provider requests

Automated tests must not call real third-party APIs. Fail on unexpected extension/application
requests; allow only explicit local fixtures and test endpoints. Keep network isolation active
before application initialization, including requests initiated by the worker.

Stub the client interface when testing a use case. Test the client itself at the HTTP boundary:
assert method, destination, headers, payload, response parsing, timeouts, and error mapping.
Use deterministic request stubs or a local fixture server. If using recorded responses, keep
replay-only behavior in normal runs and scrub credentials, cookies, personal data, and URLs.
Never silently record new interactions or require production credentials in CI.

Do not assume page-level interception covers extension-worker traffic. Verify interception
against the exact test browser and request context; use a controlled endpoint or network-level
block when necessary. Do not disable the extension worker to make mocks work in a test meant
to prove worker behavior. Test endpoint configuration must not broaden production permissions
or leave a test bypass in the shipped bundle.

### Required coverage for affected behavior

| Area                   | Required cases when applicable                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Data and domain        | Valid input, missing/invalid fields, boundary values, every declared failure outcome                                           |
| Persistence            | Correct records and query results, failed writes, no partial state where atomicity is required, migrations, concurrent updates |
| Message boundary       | Valid request, unknown operation, malformed/oversized payload, invalid sender, forged identity or target, safe response        |
| Isolation              | One tab/frame/account cannot read or mutate another's restricted data; test both permitted and rejected operations             |
| Permissions            | Missing, denied, revoked, and granted access; unsupported pages; no unrelated feature regression                               |
| Content scripts        | First and repeated injection, DOM replacement, navigation, cleanup, expected frames and excluded sites                         |
| UI                     | Success, loading, empty/error states, keyboard operation, focus, and accessible names                                          |
| Scheduled/durable work | Correct persisted inputs, execution, duplicate delivery, retry bounds, malformed/stale work, recovery after termination        |

For rejection tests, assert both the error and the absence of unauthorized writes or requests.
For idempotency, assert that running twice produces no extra stored records or external effects;
merely returning the same value twice is insufficient. Test lost responses after successful
mutations when callers may retry. If tabs or frames are intentionally shared, test that explicit
policy rather than inventing isolation the product does not promise.

### Browser harness and CI

Use Playwright's bundled Chromium with a persistent context and the documented extension-load
configuration. Pin the toolchain through the lockfile and install the matching browser in CI.
Headless extension tests are supported with an appropriate Chromium channel/configuration;
do not assume installed branded Chrome accepts the same sideload flags.

Opening the popup HTML as a normal tab can test its UI, but does not prove toolbar invocation,
user-gesture permission grants, popup sizing, or automatic closure. Cover those behaviors with
a suitable browser interaction or document a manual check when automation cannot exercise them.
Discover the loaded extension's ID; do not assume a developer-specific ID. A worker-based ID
fixture is only appropriate when the extension actually includes a worker.

Run the fast verification gate before handoff. Run browser tests for affected extension
behavior and before release; keep them in a separate CI job when CI is configured. Preserve
failure traces, screenshots, and relevant logs without secrets. Dependency/security findings
need triage; do not blanket-ignore them to make CI green. A skipped or unavailable required
browser job is a verification gap, not a passing check. Document any flaky test's cause and fix;
do not silently quarantine it or increase retries until it passes.

## References

- [Playwright extension testing](https://playwright.dev/docs/chrome-extensions)
- [Playwright network interception](https://playwright.dev/docs/network)

## Firefox harness

`npm run test:e2e:firefox` builds `dist-firefox/` and runs
`scripts/test-firefox.mjs` against stock Firefox through geckodriver's WebDriver
HTTP endpoint. Playwright's extension support remains Chromium-only. Install
geckodriver separately and set `GECKODRIVER` / `FIREFOX_BINARY` to executable paths
when discovery is unavailable. Firefox 140 is the minimum; exercise both that
version and the installed current release when changing Firefox-specific behavior.
Use `HEADLESS=0` to inspect the disposable browser.

The harness installs the actual production directory as a temporary add-on. A
rejecting loopback proxy blocks non-local HTTP(S) traffic, and deterministic local
fixtures cover authentication and rendering. Profile and server cleanup runs in a
finally block; geckodriver output is retained in
`test-results/firefox-geckodriver.log`. Tests never install into a personal profile.
Chrome and Firefox profiles are independent, but finish edits/builds before testing
and avoid simultaneous runs writing the same Firefox log.

For most monitoring cases, the harness grants only the loopback fixture hostname
through Firefox's privileged test context. This exercises real permissions and
revocation but is not evidence of first-use permission-prompt acceptance. No
privileged test endpoint is included in extension code. Keep separate evidence for
native toolbar/sidebar/prompt tests and extension-HTML-as-tab tests.

Before distribution, manually verify first-use allow and deny prompts, visible
notification delivery/clicks with system settings, sidebar draft restoration,
shadow/frame picking, and the authenticated reference site on both supported
browsers. The harness forces background termination and verifies alarm wake separately from
extension reload. Manually check natural idle behavior, abandoned rendering-tab
cleanup, browser restart, and preservation of a temporary tab the user activates.

### Firefox port verification — 2026-09-12

- `npm run verify`: 101 unit/integration tests, typecheck, lint, formatting, and
  both production builds passed.
- `npm run test:e2e`: all 21 Chromium journeys passed, including the actual side
  panel and ungranted-site picker.
- Firefox harness passed on official Firefox 140.0 and installed Firefox 155.0.1
  with geckodriver 0.36.0: authenticated reads, inert parsing, picking, rendering,
  revocation, persistence, forced background termination/alarm wake, and native
  toolbar/sidebar opening.
- Mozilla validation: zero errors, three reviewed warnings described in README.
  Unsigned Firefox ZIP inspected for intended entry points/assets and permissions.
- Firefox permission prompts, visible OS notification delivery, actual container
  UI rejection, activated-rendering-tab preservation, and live reference-site
  authentication remain manual release checks. Unit tests cover container
  rejection and notification failures; browser success is not inferred from mocks.
