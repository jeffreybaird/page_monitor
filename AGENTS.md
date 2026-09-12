# AGENTS.md — Chrome Extension

Instructions for working in this repository. Follow the user's task and applicable
higher-priority instructions. Preserve existing project conventions unless the task changes
them. The approved scope is recorded in `docs/product-decisions.md`. Do not create features
merely to satisfy examples in this file.

## Project and Stack

`Page Monitor` is a local Chrome extension that monitors selected page text and alerts on changes. Record its purpose, supported sites, UI surfaces,
required permissions, stored data, and minimum supported Chrome version in the README.
Make routine implementation choices autonomously; ask when missing information materially
changes product behavior or access to user data.

Default for a new project: **Manifest V3, strict TypeScript, Vite, semantic HTML/CSS,
Vitest, and Playwright**, with ESLint, Prettier, npm, and a committed lockfile. Use an existing
extension framework or package manager if the repository already has one. Configure all
extension entry points and manifest/assets explicitly; a normal web build is insufficient.

Keep dependencies small. Add a UI framework only when the interface warrants it. No backend,
authentication, analytics, billing, or synchronization unless the product needs them.

## Agent Workflow

The primary agent owns product decisions, architecture, integration, and final verification.
Use the project roles in `.codex/agents/`; read [docs/codex-agents.md](docs/codex-agents.md)
when coordinating them. Do not run a fixed sequence of all five agents for every task.

During initial construction, the primary agent builds the scaffold directly: manifest,
entry points, package scripts, lockfile, and test harness. Establish the product behavior,
supported sites, UI surfaces, data needs, permissions, and minimum Chrome version before
making consequential implementation choices. Do not infer product requirements from the
directory name or template examples.

Before delegating implementation, establish shared message/storage contracts where needed
and a working build and test harness. Delegate independent, bounded slices to
`extension-implementer` only when useful work can proceed concurrently. Each assignment
must name its behavior, allowed files, dependencies, shared contracts, and verification
commands. Keep manifest, package/lockfile, shared types, and storage schema under one
explicit owner at a time. Do not assume agents have isolated worktrees; avoid overlapping
writes and integrate the combined result before final verification.

Use `extension-spec-writer` for substantial behavior or risky boundaries, and
`extension-explorer` for bounded questions once relevant code exists. Run short tests
directly. Delegate substantial verification to `extension-test-runner` when independent
work remains; keep the tested source/build stable and browser profiles isolated.
Delegate a review to `extension-reviewer` for the first working scaffold and substantial
or security-sensitive changes when useful independent verification remains. The primary
agent must resolve findings and report verification gaps before handoff.

These instructions authorize conditional delegation for extension construction. Routine
documentation and configuration edits can stay with the primary agent. If custom roles
cannot be selected, read their TOML instructions and include them in the delegated task;
do not claim configuration settings or isolation were applied through that fallback.

## Simple Architecture

Create only the execution contexts and directories needed:

| Location                                       | Responsibility                                           |
| ---------------------------------------------- | -------------------------------------------------------- |
| `public/`                                      | Manifest and static assets copied into the build         |
| `src/background/`                              | Service worker and browser event handlers, if needed     |
| `src/content/`                                 | Page interaction and injected UI                         |
| `src/popup/`, `src/options/`, `src/sidepanel/` | The extension pages actually used                        |
| Other modules under `src/`                     | Shared operations, types, storage, and clients as needed |
| `tests/` or colocated tests                    | Behavior tests and fixtures                              |

Keep handlers small. Extract business rules or multi-step operations when they become
complex or need multiple callers. A popup and context-menu action should call the same
operation rather than duplicate its rules. Presentation behavior—focus, dialog state,
formatting—belongs with the UI.

Use ordinary functions by default. A small `storage.ts` module may be enough; do not introduce
repositories, domain entities, service classes, or dependency-injection infrastructure without
a concrete need. Direct Chrome API calls in handlers are fine. Wrap them when a wrapper
centralizes policy, repeated behavior, or a useful test boundary.

Pass needed inputs explicitly; avoid mutable global operation context. Keep DOM-dependent
imports out of the worker and privileged code out of page-world scripts.

## Chrome Extension Constraints

### Service worker and popup lifetime

The worker can stop between events. Globals are disposable caches, not durable state.
Register browser event listeners synchronously at module top level; perform asynchronous
initialization inside handlers. The worker has no DOM.

Persist state that must survive worker termination. Use `chrome.alarms` for scheduled work,
not long-running timers; tolerate delayed execution and recreate required alarms when missing.
Do not manufacture keepalive traffic. Add an offscreen document only for a specific need.

Popups can close at any time. Persist committed changes promptly. Operations that must outlive
the popup need an appropriate owner and a way to recover their status when it reopens.
Do not build a durable queue unless losing work would violate a product requirement.

### Permissions and messaging

Request only permissions required by a feature. Prefer `activeTab` for user-triggered page
access; use narrow host patterns for persistent access and optional permissions where practical.
Explain permission additions. Handle denied/revoked access and pages that prohibit injection.

Validate incoming messages at runtime—TypeScript types are insufficient. Allowlist operations
and verify browser-provided sender context before privileged actions. Check relevant origins,
tabs, and frames; matching the extension ID alone does not authorize every operation. Never
trust a payload's claimed identity or expose an arbitrary fetch/script/storage proxy.

Keep messages small and JSON-serializable, with one response owner per request type. Use an
asynchronous response pattern supported by the minimum Chrome version; `sendResponse` plus
literal `return true` is the compatibility option. Handle missing receivers and disconnects.
A timeout does not prove a mutation failed: retry only when duplicate execution is safe.

### Storage

Use `chrome.storage.local` for ordinary persisted data, `storage.sync` for small non-sensitive
preferences, and `storage.session` for suitable ephemeral state. Choose IndexedDB only when
transactional updates, larger datasets, or blobs justify it.

Centralize defaults and storage changes when shared. Validate stored input and migrate changed
schemas without overwriting existing user choices. Handle failed writes and quota limits.
Restrict storage access to trusted contexts where appropriate.

Concurrent read-modify-write operations can lose updates. Give shared mutable data a clear
owner; use transactions when atomicity is actually required. Several `chrome.storage` calls
are not a transaction. Keep growing datasets and DOM work bounded.

### Content scripts

Use isolated-world scripts by default. Treat host-page data and page-world bridges as untrusted.
Only use MAIN-world execution when a specific integration requires it.

Repeated injection must not duplicate UI, listeners, or observers. Scope styles; consider
Shadow DOM for substantial injected UI, but do not treat it as a security boundary. Avoid
changing unrelated page styles, globals, keyboard shortcuts, or focus.

Observe the smallest useful DOM subtree and batch expensive work. Clean up observers/listeners
when disabled or unmounted. Account for dynamic pages, navigation, relevant frames, and lost
connections after extension updates. Avoid repeatedly scanning the entire document.

### Security and privacy

Package executable dependencies. No remote scripts, CDN code imports, `eval`, `new Function`,
or execution of fetched text. Preserve a restrictive Content Security Policy. Expose only
necessary assets through narrowly scoped `web_accessible_resources`.

Render untrusted text with safe DOM APIs; sanitize rich HTML when genuinely needed. Validate
URL protocols. Packaged code and build-time variables cannot hide secrets.

Collect and retain only necessary data. Sending page contents, browsing activity, or telemetry
requires a product requirement and appropriate disclosure. Honor deletion, clear derived data
where needed, and keep credentials out of page contexts, sync storage, logs, and test fixtures.

## Code and Errors

Use strict types and validate `unknown` inputs at boundaries. Avoid casts or non-null assertions
that conceal missing-state cases. Keep abstractions proportional to actual complexity.

Expected failures should provide enough information for callers to respond. For operations
with several failure modes, a small discriminated union is useful:

```ts
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
```

Do not require Results for every function. Use stable error codes when callers need to branch;
keep user-facing wording in presentation. Handle declared outcomes and catch unexpected errors
at execution boundaries. Never report a failed write as successful.

Await asynchronous work or explicitly handle rejection. Handle Chrome API Promise rejections;
check `chrome.runtime.lastError` inside callbacks when using callback APIs. Give external
requests timeouts and validate responses. Do not automatically retry unsafe mutations.
Use simple, useful diagnostics and redact sensitive data; no tracing framework by default.

## Testing

Test each meaningful behavior change and add regression tests for reproducible bugs. Do not
weaken assertions, skip coverage, or change expectations merely to make failures disappear.
Deliberate behavior changes may update tests; explain the changed contract.

Use the cheapest test layer that proves the behavior. Unit-test business logic and meaningful
failure paths. Test storage/network boundaries when changing their contracts. Keep representative
browser journeys for actual extension behavior; do not repeat every unit case in E2E.

For affected features, cover relevant risks: invalid messages, rejected permissions, missing
content scripts, repeated injection, failed storage, updates, and work that must survive popup
closure or worker restart. Rejection tests should also verify no unauthorized side effect occurs.

Use accessible role/name selectors first and `data-testid` when useful. Avoid styling classes
as test selectors. Keep fixtures deterministic and tests isolated; block live provider requests.
Run browser tests against the built extension in a disposable profile. Testing popup HTML as a
normal tab does not prove toolbar behavior or automatic popup closure.

Read [docs/testing.md](docs/testing.md) when configuring the harness or writing browser
integration tests. It contains setup and debugging details, not additional product requirements.

## UI and Accessibility

Target WCAG 2.2 AA for extension-owned UI. Use semantic controls, accessible names, labeled
inputs, visible focus, and keyboard operation. Restore focus after dialogs; do not trap it or
steal it on injection. Meet contrast requirements and never convey state through color alone.

Support zoom and reduced motion. Give images appropriate alternative text and announce useful
asynchronous status changes without flooding live regions. Make loading, empty, unsupported,
permission-denied, and error states understandable. Prefer comfortably sized interaction targets.

## Commands and Delivery

Use actual repository scripts. For a new scaffold, establish and document these contracts:

| Command            | Purpose                                                               |
| ------------------ | --------------------------------------------------------------------- |
| `npm run dev`      | Watch/rebuild for unpacked development                                |
| `npm run verify`   | Typecheck, lint, formatting, unit/integration tests, production build |
| `npm run test:e2e` | Browser tests against a fresh production build                        |
| `npm run build`    | Production extension in `dist/`                                       |

Keep the table aligned with `package.json`; these names do not imply scripts already exist.
Document unpacked loading and when to reload the extension or target page.

Before handoff, run relevant tests and the required verification gate. Run browser tests for
affected extension behavior and before release. Report what ran and any gaps accurately.
Inspect production output for valid entry points/assets, intended permissions, and absence
of development URLs or secrets. Check fresh install and upgrade when changing persisted state.

Keep changes and commits focused. Preserve unrelated user work, follow branch conventions,
and do not rewrite shared history. Building an archive does not publish it; use the established
release workflow only when publication is requested or authorized. Keep store disclosures
consistent with shipped behavior.

Make atomic commits as work progresses: each commit should contain one coherent change and
its relevant tests or documentation. Run the applicable checks before committing. Push
completed commits directly to `main` without asking for routine confirmation; this workflow
is explicitly authorized by the user. Check remote changes before pushing, preserve others'
work, and never force-push or rewrite shared history. A Git push does not authorize store
submission or any other release action.

For platform-dependent changes, consult the official [Chrome extension documentation](https://developer.chrome.com/docs/extensions/)
and [Playwright extension guide](https://playwright.dev/docs/chrome-extensions), checking support
against the project's minimum Chrome version.
