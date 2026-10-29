# Portable local job tracking

Resolve the installed full-stack-agent-workflow directory from the skill catalog. The tracker is scripts/agent-jobs.mjs relative to that directory; its schema is scripts/AGENT-JOBS.md. Read that document and run node <absolute-tracker-path> help before first use. Node.js must be available.

Use the same default ledger for all plans: scripts/data/agent-jobs.json beside the installed tracker. Keep request/capability files in this private data directory. The main orchestrator is the sole ledger writer; never give workers credentials or ledger access. Reserve unique scopes atomically before dispatch, bind the returned agent ID, and record start only after acknowledgement. Preserve correction history, confirm execution stopped, review results, and accept explicitly. Reconcile actual runtime agents before dispatch and final reporting. Do not steal stale locks or duplicate uncertain starts.

The bundled tracker accepts absolute Windows drive-letter or POSIX paths for write ownership. Paths are conservatively case-folded for overlap detection, including on macOS. Use native absolute paths on each machine; job history is local to that machine.

Generate a standalone viewer with node <absolute-tracker-path> snapshot --output <absolute-output-html-path>. This snapshot shows recorded workflow state and requested model IDs; it is not independent model telemetry and does not refresh live. The original workspace console live server is not included.

Complete plans only after all required work is reviewed and terminal, with completionEvidence and an explicit waiver for unsuccessful terminal work. If the tracker is unavailable, restore it before dispatching tracked jobs.