# Codex agents for this extension

This design adapts the five definitions in
`/Users/jeffreybaird/src/consensus/.claude/agents` for this Chrome extension.
At inspection, this project contained `AGENTS.md` and `docs/testing.md`, but no
application, manifest, package.json, test harness, or Git repository. The product
purpose and minimum Chrome version are still unspecified. These agents do not
fill those gaps with guessed features.

## Native configuration

Project definitions live in `.codex/agents/*.toml`. Each supplies `name`,
`description`, and `developer_instructions`. Models and reasoning effort are
omitted to inherit the parent. Explorer and reviewer request `sandbox_mode =
"read-only"`; live parent permission overrides can take precedence. Role prose
is not a filesystem security boundary. See the
[official custom-agent documentation](https://learn.chatgpt.com/docs/agent-configuration/subagents#custom-agents).

No global settings or model choices are changed. Root `AGENTS.md` establishes
the scaffold-first workflow and authorizes delegation when its conditions are met.
These are agent definitions, not skills or replacements for root `AGENTS.md`.
Use a new project session to check discovery; runtime loading was not exercised
by this design task. Installed CLI observed: `codex-cli 0.153.4`.

## Relevance and changes

| Original      | Codex definition        | Relevance to a new extension                                           | Adaptation                                                                                                                                                                                                                                            |
| ------------- | ----------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Explore`     | `extension-explorer`    | Low during an empty scaffold; high once tracing cross-context behavior | Keep precise evidence and read-only work. Trace manifest, messaging, storage, worker, content scripts, and UI. Report absence instead of inventing structure.                                                                                         |
| `spec-writer` | `extension-spec-writer` | High for defining behavior and risky boundaries                        | Keep public-interface tests. Select appropriate test layers instead of requiring three for everything. Identify missing harness work. Cover applicable permission, persistence, injection, and lifetime failures.                                     |
| `implementer` | `extension-implementer` | High as a role; parallel instances premature during bootstrap          | Allow explicitly assigned scaffold files. Preserve file ownership and specs, but remove claims that shared modules and separate worktrees already exist. Report contract gaps to the lead.                                                            |
| `test-runner` | `extension-test-runner` | Medium as a dedicated agent; high for substantial browser runs         | Remove `bundle exec rspec`, Ruby stack-path assumptions, and the four-turn limit. Use real package scripts. Distinguish failed, blocked, skipped, and unrun checks. Keep concise exact failure evidence.                                              |
| `reviewer`    | `extension-reviewer`    | High, including the first working scaffold                             | Keep independent correctness review. Add extension-specific risks and accessibility. Review untracked files or a non-Git scaffold. Report verification gaps even when tests are not green. Return recurring issues instead of writing project memory. |

The original agents are good narrow role prompts, but their workflow is tailored
to an established project with pre-written specs and partitioned implementation.
Transplanting it unchanged would block initial setup, run the wrong test command,
and encourage unnecessary test duplication.

## Translation decisions

- Claude `tools` lists are not copied. Read-only defaults and role instructions
  express the intended scope without pretending Claude tool names configure Codex.
- Claude `haiku`, `sonnet`, and `opus` are not mapped to supposedly equivalent
  OpenAI models. All five use inherited settings until measured work justifies
  role-specific cost or latency tuning.
- `isolation: worktree` is not copied. The lead must establish actual isolation
  or assign disjoint files. Prompt text cannot create a worktree.
- `memory: project` becomes a reviewer handoff. Recurring lessons can be added
  deliberately to maintained project guidance; no automatic memory file is assumed.
- `maxTurns: 4` becomes bounded test commands and explicit completion reporting.
  Long browser suites need honest timeout handling, not an arbitrary turn cutoff.
- The spec writer does not automatically launch a test runner. The lead owns
  orchestration and can run short checks directly.

## Adopted construction workflow

1. The lead establishes product behavior, supported sites, UI surfaces, data
   retention, permissions, and minimum Chrome version. Resolve consequential
   ambiguity with the user before choosing those contracts.
2. One owner creates the minimal scaffold, manifest/build entries, scripts,
   lockfile, and harness according to `AGENTS.md`. Shared configuration is a poor
   starting point for simultaneous writers.
3. Use the spec-writer role for a meaningful feature or risky boundary. Start with
   acceptance criteria if the harness is not ready; verify behavior-specific
   failures once it is.
4. Assign implementation slices only after shared contracts are explicit. A slice
   should name its behavior, allowed files, dependencies, and checks. Prefer one
   owner for manifest, package/lockfile, shared message types, and storage schema.
5. Run focused checks locally. Delegate substantial verification only when useful
   independent work remains; do not race browser tests against edits to their
   source/build or share writable profiles between parallel tests.
6. Review the integrated result, resolve findings, and run the required verification
   and relevant built-extension browser checks. Report missing coverage honestly.

No sixth permanent architect, security, or accessibility agent is needed yet.
Architecture belongs with the lead; extension security and accessibility belong
in specs, implementation, and review. A narrowly scoped specialist can be added
when product complexity makes it worthwhile.

## Invocation and handoff

Example after a scaffold exists:

> Delegate a read-only review to extension-reviewer. Review the changed and new
> files for permission, message authorization, and worker-lifetime defects.
> Include file/line evidence and verification gaps. Wait for its findings.

Supply every delegated assignment with the requirement, workspace, allowed files,
relevant contracts, comparison base when applicable, test commands, and desired
output. Do not claim these fields enforce sandbox isolation.

If the client does not expose custom-agent selection, have the lead read the
relevant TOML and include its instructions explicitly in a bounded subagent task.
Do not claim its configuration fields were applied through that fallback; retain
the actual session permissions and follow the read-only role behavior where needed.

## Validation boundary

The definitions can be checked for TOML syntax, required fields, matching names,
and expected role count. This does not demonstrate discovery, permission
enforcement, or agent quality. A future runtime check should select an agent in a
fresh session and give it a bounded repository-inspection task before relying on
the configuration. No extension tests can run until the application and harness
exist.
