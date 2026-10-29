# Local agent job ledger

The ignored data/agent-jobs.json is changed only by agent-jobs.mjs. The /agents page and /api/agents endpoint are read-only projections.

Write request files under ignored data/ and pass their paths:

```powershell
node .\agent-jobs.mjs plan-create --input .\data\plan-request.json
node .\agent-jobs.mjs job-upsert --input .\data\job-request.json
node .\agent-jobs.mjs job-reserve --input .\data\reserve-request.json
```

Only gpt-6.1-sol, gpt-6.1-terra, and gpt-6-luna are accepted. The plan orchestrator is the sole ledger writer. Use its { "orchestrator", "orchestratorToken" } capability to reserve, bind, and make every lifecycle transition. It can record worker messages without a worker run token.

Reserve before spawning; it returns a run token for backward-compatible worker-originated calls. Bind the spawned ID, then start. The legacy worker call shape is { "owner", "runToken" }. If either orchestrator credential field is supplied, both fields must authenticate; invalid orchestrator credentials never fall back to a worker token. A worker reports into review; only the orchestrator completes it, with stopConfirmed: true.

Workers send STARTED, PROGRESS, REPORT, or BLOCKED messages to the orchestrator with jobId, configured model, files, verification, and blockers. The orchestrator records those messages in the ledger. Every bind and lifecycle transition adds a credential-free audit record with timestamp, from/to status, action, actor role/name, and supplied evidence/reference/report/outcome. Corrections stay on the same job: review-block, resume, then report preserves prior reports and audit history.

Use progress to refresh a started job's timestamp and progress text. Use block then resume for a temporary pause. A blocked or review job retains its write lock. Cancellation/failure of every bound job and review completion require stopConfirmed: true. There is no stale-lock theft or automatic reassignment.

A plan may optionally define acceptanceCriteria. Completing a plan requires nonempty completionEvidence. If any terminal job is failed or cancelled, completion also requires terminalWaiver (or waiverReason) explaining the exception.

Generate a snapshot without starting the console:

```powershell
node .\agent-jobs.mjs snapshot --output .\data\agent-jobs.snapshot.html
```

Run node .\agent-jobs.mjs help and node --test .\agent-jobs.test.mjs for the focused checks.
