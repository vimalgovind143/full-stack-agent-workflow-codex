# Full Stack Agent Workflow

Personal Codex skill and named agents for Windows and macOS. Astra or Sol orchestrates; Sol analyzes; Terra implements and tests; Luna handles small mechanical tasks. Subagents use low or medium reasoning only. Astra is main-only. Job reservations and evidence review prevent duplicate work.

## Model routing

| Profile | Model | Effort | Scope |
| --- | --- | --- | --- |
| astra_orchestrator | gpt-6-astra | high | Main task only; optional user selection |
| sol_analyst | gpt-6.1-sol | medium | Read-only analysis |
| terra_engineer | gpt-6.1-terra | medium | Default scoped implementation |
| terra_tester | gpt-6.1-terra | medium | Testing and evidence reports |
| sol_engineer | gpt-6.1-sol | medium | Complex implementation/escalation |
| luna_assistant | gpt-6-luna | low | Simple prescribed work |

Sol can also orchestrate as the main user-selected model. The analyst profile is not an orchestrator profile. Skills cannot change an already-running main model. Model access and named-profile loading depend on your Codex client/account.

## Install on Windows or macOS

Install Git, Node.js 24 or newer, and Codex. Sign in with access to the models above. Clone your private repository, open a terminal in its folder, then run:

```sh
node install.mjs --dry-run
node install.mjs
```

The installer uses CODEX_HOME if configured, otherwise your user profile's .codex folder. It installs only bundled skill and agent files. Different existing files cause a stop before any installation. Review them; use `--force` to back up and replace conflicting files. Unrelated files and existing tracker data are preserved. You can set `--destination PATH` explicitly. The destination defaults to CODEX_HOME or ~/.codex. The PowerShell installer remains available for Windows.

Start a fresh Codex task and invoke `$full-stack-agent-workflow`. Ask it to verify the named Terra profiles are exposed. If unavailable, inspect client/profile loading; a generic-worker fallback does not prove the named profiles loaded.

## Validate

```powershell
node --test ./skills/full-stack-agent-workflow/scripts/agent-jobs.test.mjs
```

For a named-profile smoke test, ask the orchestrator to dispatch `agent_type: terra_engineer`, then dependent `agent_type: terra_tester`, both gpt-6.1-terra/medium, on a tiny isolated fixture. Require STARTED/PROGRESS/RESULT reports, reviewed evidence, and recorded completion. Disallow generic fallback for that test. Distinguish requested/configured models from independently verified runtime identity.

## Tracking and TypeSafe

The tracker is bundled under the workflow skill's scripts directory. Its default private ledger lives in scripts/data; all data directories are ignored. Read the tracking reference before use. The tracker accepts absolute Windows drive-letter and POSIX ownership paths. It conservatively compares paths without case distinctions, which may reserve more scope on case-sensitive volumes. The standalone HTML snapshot is included through the snapshot command; the original live workspace-console server is not bundled.

TypeSafe guidance is included with its MIT license. Configure TYPESAFE_API_KEY privately on each PC for live semantic evaluations. No credentials, capabilities, prior job history, or external automations are included. TypeSafe supplements semantic evaluation; ordinary deterministic tests need no provider calls.

## Publish privately yourself

This is a local Git repository on main, with no initial commit, remote, or upstream. A local repository has no GitHub visibility setting. Create a **private** remote repository yourself before publishing. Make the first commit and configure/push it yourself. Any eventual upstream must be the same-named remote branch (main to origin/main). Never point a work branch's upstream at development for comparison purposes.

## Update another PC

Pull your own published changes into this repository, review them, then rerun `node install.mjs`. Use --force only after reviewing changed installed files; backups are created automatically. Restart Codex tasks to load the updated profiles. Editing this repository does not automatically modify an existing installed copy.
## Platform validation

Installer behavior and POSIX ownership overlap tests were exercised on Windows with Node. Run the bundled tests and named-profile smoke test on the Mac; native macOS execution has not been verified here.
