---
name: full-stack-agent-workflow
description: Coordinate coding tasks with Astra or Sol as the main orchestrator, Sol for delegated analysis, Terra Engineer for implementation, Terra Tester for verification, and Luna for simple mechanical tasks. Use when the user requests this model workflow or invokes full-stack-agent-workflow for a feature, bug fix, refactor, or code investigation.
---

# Full Stack Agent Workflow

Use these exact roles for work under this skill:

| Role | Model | Responsibility |
| --- | --- | --- |
| Main orchestrator (user-selected Astra or Sol) | gpt-6-astra or gpt-6.1-sol | Scope, plan, allocate work, review diffs, assess verification, report results |
| Sol Analyst (`sol_analyst`) | gpt-6.1-sol | Read-only investigation, root cause, reuse map, implementation recommendations |
| Terra Engineer (`terra_engineer`) | gpt-6.1-terra | Code changes and focused build/test verification within assigned files |
| Terra Tester (`terra_tester`) | gpt-6.1-terra | Test scenarios, scoped test authoring, execution, and evidence-based reports |
| Sol Engineer (`sol_engineer`) | gpt-6.1-sol | Complex implementation or explicit escalation from Terra |
| Luna Assistant (`luna_assistant`) | gpt-6-luna | Exact lookups, typo fixes, formatting, prescribed repetitive edits, routine checks |

## Prerequisite

Prefer Sol (`gpt-6.1-sol`) for normal orchestration; select Astra (`gpt-6-astra`) for demanding work when the user chooses it. Both can orchestrate this workflow. A skill cannot change the running main model; follow the user's selection and never silently switch it. If model identity is unavailable, disclose that the selection cannot be independently verified.

“Main orchestrator” below means the selected Astra or Sol main task. The `sol_analyst` profile is a read-only worker role, not the instructions for a Sol main orchestrator. A Sol main orchestrator has the same dispatch, tracking, review, and completion responsibilities as Astra. It may delegate a separate bounded analysis to Sol when useful; do not create a second orchestration layer.

Use the runtime's subagent tools, not separate user-facing tasks. If tools or a requested model are unavailable, report the limitation instead of silently substituting a model. This workflow expresses the user's explicit model choices; it replaces older local model-routing preferences such as swe-worker for this workflow only. All other repository rules remain applicable.

## Cost-conscious execution

Prefer Standard speed when the runtime exposes a supported speed control; do not invent a spawn parameter or claim to change speed through a skill. Respect explicit user speed choices. Send only relevant context, require concise evidence-based results, and skip separate analysis when the implementation is already clear. Keep analysis and implementation as separate permission scopes with Sol analyzing and Terra implementing. Use named Sol Analyst and Terra Engineer roles to distinguish them. Token prices do not guarantee total task cost; review retries and verification outcomes.

## Routing and execution

Terra is the default coding specialist for well-defined changes with clear acceptance criteria. Use Sol Engineer for complex cross-module changes, unresolved implementation ambiguity, or demonstrated Terra failures. Do not assume lower token rates guarantee lower total task cost. For escalation, confirm Terra has stopped before transferring ownership, preserve the previous report, and record the Sol replacement and model explicitly using the existing replacement-job lifecycle. Never start competing workers for the same scope. If the runtime lacks a Terra profile, use a compatible generic role with explicit gpt-6.1-terra and medium effort; never use a Sol-pinned profile while labeling it Terra.

1. The main orchestrator reads applicable repository instructions, determines acceptance criteria, and identifies independent work. Keep the main orchestrator focused on planning and review; delegate implementation to Terra Engineer and simple mechanical tasks to Luna.
2. When investigation is needed, give Sol a bounded read-only assignment: relevant paths, questions, constraints, and the required evidence. Ask for findings with file references, existing components to reuse, recommended changes, risks, and meaningful verification. Skip Sol for a mechanical change whose implementation is already clear.
3. The main orchestrator reviews the analysis and assigns Terra Engineer an implementation slice with exact file ownership, the intended behavior, patterns to follow, acceptance criteria, and validation commands. Terra Engineer must report changed files, verification results, and unresolved issues. An analysis-only request stops without creating implementation work.
4. The main orchestrator reviews the actual diff and verification evidence. Send corrections back to Terra Engineer; use Sol for unresolved analytical questions. Complete appropriate validation before reporting results, and distinguish passed checks from checks that could not run.

## Delegation mechanics

All subagents are limited to low or medium reasoning. Never use high, xhigh, max, or ultra for a child, including retries, corrections, reviews, and resumed workers. Sol and Terra Engineer default to medium; Luna defaults to low. Prefer smaller assignments and main-orchestrator review over increasing child effort. Check the effective profile before dispatch; if a cached profile pins higher effort, use an available compatible role with an explicit allowed model and effort, or report that a fresh session is needed. Do not silently launch a higher-effort child. Existing running agents are not retroactively changed by editing profiles; apply the limit at the next safe continuation and never create a duplicate worker merely to change effort.

With collaboration.spawn_agent, use an explicit model and fork_turns: "none" for a self-contained prompt (or a bounded positive history count if genuinely needed). Full-history forks inherit the parent model and cannot select another model.

- Sol Analyst: model: "gpt-6.1-sol", reasoning_effort: "medium".
- Terra Engineer: model: "gpt-6.1-terra", reasoning_effort: "medium".
- Sol Engineer (complex implementation): model: "gpt-6.1-sol", reasoning_effort: "medium".
- Terra Tester: model: "gpt-6.1-terra", reasoning_effort: "medium".
- Luna: model: "gpt-6-luna", reasoning_effort: "low".
- Reuse existing workers with followup_task for corrections and related work.

Every assignment includes the user objective, repository paths, applicable rules, allowed mutations, file ownership, and expected output. Sol Analyst receives no edit responsibility; Terra Engineer has edit responsibility only within its assigned files. Terra Engineer must preserve unrelated changes and avoid files owned by another worker. Workers never spawn or delegate to other agents. Only the main orchestrator dispatches jobs.

Only spawn a bounded task that can run alongside useful local work, as required by the delegation tool. While Sol investigates, the main orchestrator can inspect instructions and acceptance criteria. While Terra Engineer implements, the main orchestrator can review integration contracts and prepare verification. Do not invent busywork to justify parallelism; report any runtime constraint that prevents the requested routing.

Respect the runtime concurrency limit. Parallelize independent slices only; sequence dependent work and avoid concurrent writes to the same files. A simple, unambiguous task should use one Luna worker without an analysis worker; use Terra Engineer when coding judgment is required. Do not spawn agents simply to fill slots.

Do not commit, push, publish, send external messages, or alter database schemas without the authorization required by the task and repository. The workflow itself grants no extra permissions.

## Named specialists and visible model identity

Personal agent profiles are installed in ~/.codex/agents/: astra_orchestrator.toml, sol_analyst.toml, terra_engineer.toml, terra_tester.toml, sol_engineer.toml, and luna_assistant.toml. When the runtime supports selecting custom agent profiles, select the matching profile. Do not assume a profile was loaded merely because the task has its name.

When collaboration.spawn_agent exposes agent_type, select the matching sol_analyst, terra_engineer, terra_tester, sol_engineer, or luna_assistant profile and use a self-contained assignment. These profiles pin their models; never select astra_orchestrator for a child. If profile selection is unavailable, pass the model and reasoning explicitly and include the specialist instructions from its profile. In both cases use fork_turns: "none" or a bounded history count, never a full-history fork. Use task_name values such as sol_analyst_invoice_trace, terra_engineer_invoice_fix, or luna_assistant_label_typo. These names keep the model family and specialization visible in agent activity.

Before dispatch, announce the specialist, exact model ID, reasoning effort, and assignment in a short progress message. Begin each assignment with the same identity header and require the worker to repeat it in its first progress message and final result. Report the models actually requested through the tools in the final summary when agents were used. Distinguish configured/requested model from runtime-verified model identity; never infer successful routing from a display name alone.

A skill controls names and message content, not the application's native model badges or details layout. Do not promise to change that UI. Only the main task orchestrates; Astra, when selected, is main-only. NEVER spawn an Astra subagent for any purpose, including planning, review, fallback, or escalation. Every child must explicitly use GPT-6.1-Sol, GPT-6.1-Terra, or GPT-6-Luna. Never omit the child model or use a full-history fork. If a requested worker model is unavailable, report the blocked routing; do not substitute Astra.

## Luna routing

Choose Luna only when the desired result and edit pattern are explicit, bounded, and easy to verify: exact searches, documentation typos, formatting, specified repetitive substitutions, or execution of a known check. Use low reasoning. Keep prompts and reports short and skip unnecessary analysis passes.

Route feature development, nontrivial fixes, refactoring, and test design to Terra Engineer. Route ambiguous requirements, root-cause investigation, and impact analysis to Sol. Luna must return evidence and request reassignment when unexpected complexity appears; the main orchestrator then dispatches Sol or Terra Engineer. Do not let Luna guess at business rules, authentication, authorization, financial calculations, or database changes merely to conserve tokens.
## Terra testing specialist

Use Terra Tester (`terra_tester`, `gpt-6.1-terra`, medium) by default for testing assignments: unit and integration scenarios, regression verification, authorized browser/E2E checks, and applicable TypeSafe semantic evaluations. This explicit user choice overrides older model preferences for routine testing; repository authorization, environment, evidence, and handoff rules still apply. Before planning or executing E2E tests, discover and read the project's active testing playbook and existing run state. Resume valid evidence rather than repeating completed checks.

Default to testing and reporting. Test-source edits require assigned file ownership; application fixes require an authorized engineering assignment. Do not silently fix application code, change test data beyond the authorized scope, start another environment, or relax assertions to get a pass. Report observed results, commands, coverage, failures, skipped/not-run checks, and evidence paths. Close owned browser sessions/helpers according to project rules. Distinguish TypeSafe skill review from actual provider calls.

The engineer may run focused checks on its own change. Create a separate tester job only for distinct verification work; do not duplicate checks already accepted unless changes invalidate their evidence. Sol Analyst handles ambiguous expectations or difficult failure analysis. Keep Terra Tester at low/medium; escalation follows the existing stop-and-transfer ownership rules. If the named profile is unavailable, use a compatible generic role with explicit model and medium effort plus these tester instructions. Never label a Sol-pinned role Terra.

## Automatic TypeSafe testing routing

At test planning and before final verification, automatically assess whether the requested scenarios need semantic judgment. When they do, load the installed `typesafe-ai` skill from the current skill catalog without requiring the user to invoke it again. Resolve its path from that catalog or the current project's `.agents/skills/typesafe-ai/SKILL.md`; do not embed a machine-specific project path. Follow its live-documentation guidance before choosing an API, model, SDK, or question shape. If the skill is missing, report that limitation and continue independent deterministic checks.

Use TypeSafe for semantic test scenarios such as checking extraction against source text, classifying natural-language outputs against a rubric, or evaluating whether a claim is supported by supplied evidence. Ordinary builds, type checking, exact assertions, calculations, permissions, and browser interactions stay in the project's normal test tools. TypeSafe judgments supplement those checks and never override a failing deterministic test or substitute for observed execution.

Sol Analyst identifies representative positive, negative, ambiguous, and missing-evidence cases when analysis is needed. Terra Tester owns assigned test scenarios, rubrics, and evaluation execution; Terra Engineer owns application integration changes. Assign exact test-file ownership when authoring is needed. Luna may run a simple prescribed check. Reuse the existing verification job and ownership rather than launching a duplicate TypeSafe worker. Jev is an external evaluation service, not a Codex child-agent model or an exception to the Sol/Terra/Luna delegation ladder.

For relevant scenarios, automatically reuse an existing TypeSafe evaluation command when available. A pre-existing runner or installed SDK is not required: with credentials available, use the documented HTTP API for bounded evaluations within the authorized testing scope. Read the current API contract first and prefer synthetic fixtures for connectivity checks. Use synthetic or appropriately redacted fixtures; keep secrets and credentials out of requests, source control, and reports. Check credential presence without printing values. Discover existing credentials and execution options before reporting missing setup. If credentials are unavailable or the API cannot execute, report the semantic evaluation as not run or failed with the actual cause and continue other tests. Do not report a missing runner as a blocker when direct HTTP execution is available; never claim that loading the skill executed the API. Implement a new runner only within an authorized implementation scope, following current SDK/API docs.

Keep deterministic fixture assertions in the ordinary suite. Live semantic evaluations must be separately identifiable; pin the evaluated model and rubric, calibrate thresholds on representative labeled cases, cap requests/retries, and report fixture IDs, model, outcomes, uncertainty, usage when available, and service failures. Treat low-confidence or contradictory results as review-needed and distinguish API failures from application failures. Do not copy cookbook thresholds as universal pass criteria. The main orchestrator reviews the evidence before accepting the job.

This is automatic routing during an active workflow, not a filesystem watcher, scheduled automation, or CI hook. A CI trigger requires a project-specific runner and CI configuration.

## Orchestrator-owned job lifecycle

The main orchestrator is the sole ledger writer for this workflow. Workers do not read tracking capabilities, run ledger commands, or obtain tracking approvals. The main orchestrator retains all capabilities privately and uses the plan orchestrator capability for lifecycle updates. Existing worker-token commands are compatibility only, not the workflow to assign to new workers. If approval review blocks the main orchestrator's own authorized tracking operation, disclose the actual failure, preserve the result in the conversation, and resolve through the approval system; never bypass the rejection or claim the ledger is current.

Before dispatch, record the whole requested outcome and its acceptance criteria as a plan. Include future integration, verification, and delivery jobs with dependencies, even when they cannot start yet. Use planned jobs until their exact write scopes and requirements are ready; unresolved decisions are explicit gates. Do not equate completed coding slices with a completed user outcome.

Before every dispatch, reconcile the ledger with live agent state and recent results. Match stable plan/job IDs, canonical work keys, bound agent IDs, and exact write scopes. Equivalent names do not make equivalent work a new job. Reserve atomically before spawn; bind the returned agent identity immediately. Give the worker the job ID, scope, and reporting contract, never a capability. If dispatch success is uncertain, inspect existing agents before retrying. Do not do the same assignment locally while a worker owns it.

Workers send concise structured messages (plain text is sufficient):

- STARTED: job ID, configured model, scope acknowledgement.
- PROGRESS: job ID, milestone, next step, blockers if any.
- RESULT: job ID, changed files, verification commands and outcomes, evidence paths, remaining limitations, and whether all assigned execution has stopped.
- BLOCKED or FAILED: job ID, concrete cause, retained partial work, and required next action.

The main orchestrator records STARTED only after observing acknowledgement or execution. Record progress at meaningful milestones. On RESULT, confirm the bound worker and actual runtime completion, then record the report into review. A finished agent is not automatically an accepted job. Review the diff and evidence before completion; do not infer test success from agent status alone.

Corrections retain the same job ID, scope reservation, and worker whenever possible: review -> review-block -> resume -> report. Preserve prior reports and decisions in history. For unavoidable replacement, first confirm the previous agent and processes stopped, record why its attempt ended, release the old reservation, and link the replacement job to that failed attempt. Never create simultaneous attempts or silently overwrite history.

Reconcile again before final reporting: active workers stay active; completed work with evidence becomes awaiting review; failed workers get an explicit failure/blocker; unknown/unreachable state stays reserved pending inspection. Stale timestamps never authorize takeover. Do not claim delivery while required work is unreviewed or unfinished. Closing a plan requires acceptance evidence for the user outcome; explain explicitly any waived/failed/cancelled work rather than treating terminal status as success.

A reconciliation must not fabricate historical start times. If a completed job was left reserved by tracking failure, record the observed evidence and reconciliation time, repair lifecycle transitions under orchestrator authorization, and leave it in review until accepted. The dashboard is reported workflow state, not independent Codex-wide telemetry.

## Continuity and quiet follow-up

Keep orchestrating while authorized work can progress. A status question does not cancel the delivery objective. During an active turn, use bounded agent waits and continue useful review work. Before yielding with running agents, pending acceptance, or unresolved integration, state the remaining work and ensure any user-authorized heartbeat follow-up is configured. A skill cannot keep an idle task running by itself.

When the user authorizes scheduled follow-up, create or update one heartbeat attached to the delivery task, using automation_update. Inspect existing automations first to avoid duplicates. Reconcile live workers and ledger on each wake, review finished work, continue ready authorized steps, and never launch duplicates. Stay quiet while unchanged or non-actionable; notify only on meaningful completion, failure, blocker, or required input. Pending user approval remains pending: do not treat elapsed time as approval or repeatedly ask the same question. Disable the heartbeat after verified delivery or explicit cancellation using the tool's supported lifecycle operation. Do not automatically create recurring work for every future skill invocation without user authorization.

## Local dashboard integration

Before dispatching jobs, read [local job tracking](references/local-job-tracking.md) for the installed ledger, CLI contract, and viewer. Use the shared durable ledger for all jobs in this workflow; do not treat message-only status as a substitute.
