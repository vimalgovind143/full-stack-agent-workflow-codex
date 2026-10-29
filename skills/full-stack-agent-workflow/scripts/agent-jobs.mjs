#!/usr/bin/env node
/**
 * Local, file-backed ledger for dispatching coding agents. Mutations are only
 * available through this CLI/library; the workspace console consumes its
 * sanitized read model through a GET endpoint.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_LEDGER_FILE = path.join(HERE, "data", "agent-jobs.json");
const ALLOWED_MODELS = new Set(["gpt-6.1-sol", "gpt-6.1-terra", "gpt-6-luna"]);
const TERMINAL = new Set(["completed", "failed", "cancelled"]);
const LOCKING = new Set(["reserved", "started", "review", "blocked"]);

function now() { return new Date().toISOString(); }
function fail(message) { throw new Error(message); }
function text(value, name) {
  if (typeof value !== "string" || !value.trim()) fail(`${name} is required`);
  return value.trim();
}
function tokenHash(token) { return crypto.createHash("sha256").update(text(token, "token")).digest("hex"); }
function newToken() { return crypto.randomBytes(24).toString("base64url"); }
function safeId(value, name = "id") {
  const id = text(value, name);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)) fail(`${name} must use letters, numbers, dot, underscore, colon, or dash`);
  return id;
}
export function canonicalKey(value) {
  return text(value, "canonicalKey").toLocaleLowerCase("en-US").replace(/\s+/g, " ");
}
export function normalizeWritePath(value) {
  const source = text(value, "write resource");
  const windows = /^[A-Za-z]:[\\/]/.test(source);
  if (windows) return path.win32.normalize(source).replace(/[\\/]+$/, "").toLocaleLowerCase("en-US");
  if (!source.startsWith("/") || source.startsWith("//")) fail("write resource must be an absolute Windows drive or POSIX path");
  // Conservative case folding also prevents overlapping claims on default macOS volumes.
  return path.posix.normalize(source).replace(/\/+$/, "").toLocaleLowerCase("en-US") || "/";
}
function writeResources(values) {
  if (!Array.isArray(values)) fail("writeResources must be an array");
  return [...new Set(values.map(normalizeWritePath))];
}
export function pathsOverlap(left, right) {
  const boundary = (value) => value.endsWith("/") ? value : value + (value.startsWith("/") ? "/" : "\\");
  return left === right || left.startsWith(boundary(right)) || right.startsWith(boundary(left));
}
function overlaps(resources, otherResources) {
  return resources.some((a) => otherResources.some((b) => pathsOverlap(a, b)));
}
function emptyLedger() { return { version: 1, updatedAt: null, plans: [], jobs: [] }; }
function ensureLedger(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.plans) || !Array.isArray(value.jobs)) fail("ledger is malformed");
  return value;
}
export function readLedger(file = DEFAULT_LEDGER_FILE) {
  try { return ensureLedger(JSON.parse(fs.readFileSync(file, "utf8"))); }
  catch (error) { if (error?.code === "ENOENT") return emptyLedger(); throw error; }
}
function acquireLock(file) {
  const lock = `${file}.lock`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let fd;
  try {
    fd = fs.openSync(lock, "wx", 0o600);
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, acquiredAt: now() }));
  } catch (error) {
    if (error?.code === "EEXIST") fail(`ledger is locked at ${lock}; refusing to steal a lock`);
    throw error;
  } finally { if (fd !== undefined) fs.closeSync(fd); }
  return () => { try { fs.unlinkSync(lock); } catch { /* do not hide a completed mutation */ } };
}
function atomicWrite(file, ledger) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(ledger, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, file);
}
function mutate(file, fn) {
  const unlock = acquireLock(file);
  try {
    const ledger = readLedger(file);
    const result = fn(ledger);
    ledger.updatedAt = now();
    atomicWrite(file, ledger);
    return result;
  } finally { unlock(); }
}
function activePlan(plan) { return plan && !["completed", "cancelled"].includes(plan.status); }
function lockingJob(job) { return LOCKING.has(job.status); }
function getPlan(ledger, planId) {
  const plan = ledger.plans.find((item) => item.id === planId);
  if (!plan) fail(`plan ${planId} does not exist`);
  return plan;
}
function getJob(ledger, jobId) {
  const job = ledger.jobs.find((item) => item.id === jobId);
  if (!job) fail(`job ${jobId} does not exist`);
  return job;
}
function assertModel(model) {
  if (!ALLOWED_MODELS.has(model)) fail(`model must be one of ${[...ALLOWED_MODELS].join(", ")}; Astra is not permitted`);
  return model;
}
function assertCanonicalKeyFree(ledger, candidate, excludingId) {
  for (const other of ledger.jobs) {
    if (other.id === excludingId || TERMINAL.has(other.status)) continue;
    const otherPlan = ledger.plans.find((plan) => plan.id === other.planId);
    if (activePlan(otherPlan) && other.canonicalKey === candidate.canonicalKey) fail(`canonicalKey is already active in job ${other.id}`);
  }
}
function assertWriteScopeFree(ledger, candidate, excludingId) {
  if (!lockingJob(candidate)) return;
  for (const other of ledger.jobs) {
    if (other.id === excludingId || !lockingJob(other)) continue;
    const otherPlan = ledger.plans.find((plan) => plan.id === other.planId);
    if (activePlan(otherPlan) && overlaps(candidate.writeResources, other.writeResources)) fail(`writeResources overlap active job ${other.id}`);
  }
}
function assertWorker(job, input) {
  if (job.owner !== text(input.owner, "owner") || job.runTokenHash !== tokenHash(input.runToken)) fail("worker owner or run token is not authorized for this job");
}
function assertOrchestrator(plan, input) {
  if (plan.orchestrator !== text(input.orchestrator, "orchestrator") || plan.orchestratorTokenHash !== tokenHash(input.orchestratorToken)) fail("orchestrator capability is not authorized for this plan");
}
function hasOrchestratorCredential(input) {
  return input.orchestrator !== undefined || input.orchestratorToken !== undefined;
}
function lifecycleActor(job, plan, input) {
  // An attempted orchestrator capability must never fall back to a worker token.
  if (hasOrchestratorCredential(input)) {
    assertOrchestrator(plan, input);
    return { role: "orchestrator", name: plan.orchestrator };
  }
  assertWorker(job, input);
  return { role: "worker", name: job.owner };
}
function optionalText(value, name) {
  if (value === undefined || value === null || value === "") return undefined;
  return text(value, name);
}
function auditDetails(input) {
  const evidence = optionalText(input.evidence, "evidence");
  const reference = optionalText(input.reference, "reference");
  const report = optionalText(input.report, "report");
  const outcome = optionalText(input.outcome, "outcome");
  return { ...(evidence ? { evidence } : {}), ...(reference ? { reference } : {}), ...(report ? { report } : {}), ...(outcome ? { outcome } : {}) };
}
function appendHistory(job, { from, action, actor, input }) {
  (job.history ??= []).push({ timestamp: now(), from, to: job.status, action, actor, ...auditDetails(input) });
}
function publicJob(job) {
  const { runTokenHash, ...safe } = job;
  return safe;
}
function publicPlan(plan) {
  const { orchestratorTokenHash, ...safe } = plan;
  return safe;
}

/** Creates an active plan. The returned orchestratorToken is a distinct capability. */
export function createPlan(input, file = DEFAULT_LEDGER_FILE) {
  return mutate(file, (ledger) => {
    const id = safeId(input.id, "plan id"), title = text(input.title, "plan title");
    if (ledger.plans.some((plan) => plan.id === id)) fail(`plan ${id} already exists`);
    if (ledger.plans.some((plan) => activePlan(plan) && plan.title.toLocaleLowerCase("en-US") === title.toLocaleLowerCase("en-US"))) fail(`active plan title already exists: ${title}`);
    const orchestratorToken = input.orchestratorToken || newToken();
    const acceptanceCriteria = optionalText(input.acceptanceCriteria, "acceptanceCriteria");
    const plan = { id, title, status: "active", orchestrator: text(input.orchestrator, "orchestrator"), orchestratorTokenHash: tokenHash(orchestratorToken), ...(acceptanceCriteria ? { acceptanceCriteria } : {}), createdAt: now(), updatedAt: now() };
    ledger.plans.push(plan);
    return { plan: publicPlan(plan), orchestratorToken };
  });
}

/** Creates or updates an unreserved planned job. Scope becomes immutable once reserved. */
export function upsertJob(input, file = DEFAULT_LEDGER_FILE) {
  return mutate(file, (ledger) => {
    const id = safeId(input.id, "job id"), planId = safeId(input.planId, "planId");
    const plan = getPlan(ledger, planId);
    assertOrchestrator(plan, input);
    if (!activePlan(plan)) fail(`plan ${planId} is not active`);
    const candidate = { id, planId, title: text(input.title, "job title"), canonicalKey: canonicalKey(input.canonicalKey), model: assertModel(input.model), dependencies: [...new Set((input.dependencies || []).map((id) => safeId(id, "dependency")))], writeResources: writeResources(input.writeResources) };
    if (candidate.dependencies.includes(id)) fail("a job cannot depend on itself");
    for (const dependency of candidate.dependencies) getJob(ledger, dependency);
    const existing = ledger.jobs.find((job) => job.id === id);
    if (existing && (existing.status !== "planned" || existing.planId !== planId)) fail(`job ${id} is already reserved or belongs to a different plan`);
    assertCanonicalKeyFree(ledger, candidate, id);
    const job = { ...candidate, status: "planned", createdAt: existing?.createdAt || now(), updatedAt: now(), owner: null, agentId: null, reservedAt: null, startedAt: null, reportedAt: null, reviewedAt: null, endedAt: null, report: null, reports: [], progress: null, outcome: null, history: [] };
    if (existing) Object.assign(existing, job); else ledger.jobs.push(job);
    return publicJob(job);
  });
}

/** Atomically reserves work before a worker is spawned. The token is returned once. */
export function reserveJob(input, file = DEFAULT_LEDGER_FILE) {
  return mutate(file, (ledger) => {
    const job = getJob(ledger, safeId(input.id, "job id"));
    const plan = getPlan(ledger, job.planId);
    assertOrchestrator(plan, input);
    if (!activePlan(plan)) fail(`plan ${plan.id} is not active`);
    if (job.status !== "planned") fail(`job ${job.id} is ${job.status}; it cannot be reserved again`);
    for (const id of job.dependencies) if (getJob(ledger, id).status !== "completed") fail(`dependency ${id} is not completed`);
    assertCanonicalKeyFree(ledger, job, job.id);
    assertWriteScopeFree(ledger, { ...job, status: "reserved" }, job.id);
    const runToken = input.runToken || newToken();
    job.owner = text(input.owner, "owner");
    job.runTokenHash = tokenHash(runToken);
    job.status = "reserved";
    job.reservedAt = job.updatedAt = now();
    return { job: publicJob(job), runToken };
  });
}

/** Binds the agent id returned by the spawn operation; it deliberately does not start work. */
export function bindAgent(input, file = DEFAULT_LEDGER_FILE) {
  return mutate(file, (ledger) => {
    const job = getJob(ledger, safeId(input.id, "job id"));
    const plan = getPlan(ledger, job.planId);
    const actor = lifecycleActor(job, plan, input);
    if (job.status !== "reserved") fail(`job ${job.id} must be reserved before its agent is bound`);
    if (job.agentId) fail(`job ${job.id} already has agent ${job.agentId}`);
    const from = job.status;
    job.agentId = text(input.agentId, "agentId");
    appendHistory(job, { from, action: "bind", actor, input });
    job.updatedAt = now();
    return publicJob(job);
  });
}

/**
 * Applies lifecycle changes. Worker transitions may instead be made by the
 * plan orchestrator; review completion remains orchestrator-only.
 */
export function transitionJob(input, file = DEFAULT_LEDGER_FILE) {
  return mutate(file, (ledger) => {
    const job = getJob(ledger, safeId(input.id, "job id"));
    const plan = getPlan(ledger, job.planId);
    const action = text(input.action || input.status, "action");
    const workerActions = new Set(["start", "progress", "report", "block", "resume", "fail", "cancel"]);
    const orchestrationActions = new Set(["complete", "review-block", "review-fail", "review-cancel"]);
    let actor;
    if (workerActions.has(action)) actor = lifecycleActor(job, plan, input);
    else if (orchestrationActions.has(action)) { assertOrchestrator(plan, input); actor = { role: "orchestrator", name: plan.orchestrator }; }
    else fail(`unknown action ${action}`);
    const from = job.status;
    const requireStop = () => { if (input.stopConfirmed !== true) fail("stopConfirmed: true is required before releasing a review or blocked job lock"); };
    if (action === "start") {
      if (job.status !== "reserved" || !job.agentId) fail("only a bound reserved job can start");
      job.status = "started"; job.startedAt = now();
    } else if (action === "progress") {
      if (job.status !== "started") fail("only a started job can record progress");
      job.progress = text(input.report, "report");
    } else if (action === "report") {
      if (job.status !== "started") fail("only a started job can report");
      const priorReport = job.report;
      const reports = (job.reports ??= []);
      if (!reports.length && priorReport) reports.push({ timestamp: job.reportedAt || now(), report: priorReport });
      job.status = "review"; job.report = text(input.report, "report"); reports.push({ timestamp: now(), report: job.report }); job.reportedAt = now();
    } else if (action === "block") {
      if (job.status !== "started") fail("only a started job can be blocked");
      job.status = "blocked"; job.outcome = text(input.outcome || input.report, "block reason");
    } else if (action === "resume") {
      if (job.status !== "blocked") fail("only a blocked job can resume");
      job.status = "started";
    } else if (action === "fail" || action === "cancel") {
      const allowedStatuses = action === "cancel" && actor.role === "orchestrator" ? ["planned", "reserved", "started", "blocked"] : ["reserved", "started", "blocked"];
      if (!allowedStatuses.includes(job.status)) fail(`${action} is not allowed from ${job.status}`);
      if (job.agentId) requireStop();
      job.status = action === "fail" ? "failed" : "cancelled"; job.outcome = text(input.outcome, "outcome"); job.endedAt = now();
    } else if (action === "complete") {
      if (job.status !== "review") fail("only a reported job in review can complete");
      requireStop(); job.status = "completed"; job.outcome = text(input.outcome, "outcome"); job.reviewedAt = job.endedAt = now();
    } else if (action.startsWith("review-")) {
      if (job.status !== "review") fail(`only a review job can ${action}`);
      const next = action.slice("review-".length);
      if (next === "block") { job.status = "blocked"; job.outcome = text(input.outcome, "outcome"); }
      else { requireStop(); job.status = next === "fail" ? "failed" : "cancelled"; job.outcome = text(input.outcome, "outcome"); job.endedAt = now(); }
      job.reviewedAt = now();
    }
    appendHistory(job, { from, action, actor, input });
    job.updatedAt = now();
    return publicJob(job);
  });
}

export function transitionPlan(input, file = DEFAULT_LEDGER_FILE) {
  return mutate(file, (ledger) => {
    const plan = getPlan(ledger, safeId(input.id, "plan id"));
    assertOrchestrator(plan, input);
    const action = text(input.action, "action");
    if (!["complete", "cancel"].includes(action)) fail("plan action must be complete or cancel");
    const jobs = ledger.jobs.filter((job) => job.planId === plan.id);
    if (jobs.some((job) => !TERMINAL.has(job.status))) fail("all plan jobs must be terminal before the plan can close");
    if (action === "complete") {
      plan.completionEvidence = text(input.completionEvidence || input.evidence, "completionEvidence");
      if (jobs.some((job) => job.status !== "completed")) plan.terminalWaiver = text(input.terminalWaiver || input.waiver || input.waiverReason, "terminalWaiver");
    }
    plan.status = action === "complete" ? "completed" : "cancelled";
    plan.closedAt = plan.updatedAt = now();
    return publicPlan(plan);
  });
}
export function dashboardData(file = DEFAULT_LEDGER_FILE) {
  const ledger = readLedger(file);
  const jobs = ledger.jobs.map(publicJob);
  return {
    updatedAt: ledger.updatedAt,
    plans: ledger.plans.map((plan) => ({ ...publicPlan(plan), jobs: jobs.filter((job) => job.planId === plan.id) })),
    jobs: jobs.filter((job) => !ledger.plans.some((plan) => plan.id === job.planId)),
  };
}
function esc(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]); }
export function snapshotHtml(file = DEFAULT_LEDGER_FILE) {
  const data = dashboardData(file);
  const cards = data.plans.map((plan) => `<section><h2>${esc(plan.title)} <small>${esc(plan.status)}</small></h2><p>Plan: ${esc(plan.id)} · orchestrator: ${esc(plan.orchestrator)}</p>${plan.jobs.length ? plan.jobs.map((job) => `<article><b>${esc(job.title)}</b><br><small>${esc(job.id)} · ${esc(job.model)} · ${esc(job.status)}${job.owner ? ` · ${esc(job.owner)}` : ""}</small>${job.report ? `<pre>${esc(job.report)}</pre>` : ""}${job.outcome ? `<pre>${esc(job.outcome)}</pre>` : ""}</article>`).join("") : "<p>No jobs.</p>"}</section>`).join("") || "<p>No plans recorded.</p>";
  return `<!doctype html><meta charset="utf-8"><title>Agent Jobs Snapshot</title><style>body{background:#0b1520;color:#e8f1f8;font:14px system-ui;margin:2rem;max-width:1100px}section,article{background:#10202e;border:1px solid #1d3346;border-radius:8px;padding:1rem;margin:.75rem 0}h1,h2{color:#00bbe3}small,p{color:#9cb3c4}pre{white-space:pre-wrap;color:#d9e8f5}</style><h1>Agent Jobs Snapshot</h1><p>Generated ${esc(new Date().toISOString())}; ledger updated ${esc(data.updatedAt || "never")}.</p>${cards}`;
}

function help() { return `agent-jobs.mjs - local agent-work ledger

Use a JSON input file so run and orchestrator tokens never enter shell history:
  node agent-jobs.mjs <command> --input request.json

Commands: help, init, plan-create, job-upsert, job-reserve, job-bind, job-transition, plan-transition, read, snapshot
Snapshot requires --output path/to/agents-snapshot.html.

plan-create: { id, title, orchestrator, orchestratorToken?, acceptanceCriteria? }
job-upsert: { id, planId, title, canonicalKey, model, dependencies: [], writeResources: [], orchestrator, orchestratorToken }
job-reserve: { id, owner, runToken?, orchestrator, orchestratorToken }
job-bind: { id, agentId, orchestrator, orchestratorToken } or legacy { id, owner, runToken, agentId }
job-transition lifecycle: start, progress, report, block, resume, fail, cancel. Use the plan orchestrator capability or legacy worker credentials.
job-transition review: complete, review-block, review-fail, review-cancel; orchestrator capability required.
If any orchestrator credential is supplied, both fields must authenticate and worker fallback is refused.
Every bind and lifecycle transition creates credential-free audit history. Plan complete requires completionEvidence and terminalWaiver when any job failed or was cancelled.
review/blocked release requires stopConfirmed: true. Completion is only from review.
`; }
function argValue(args, name) { const index = args.indexOf(name); return index < 0 ? null : args[index + 1]; }
function main() {
  const [command = "help", ...args] = process.argv.slice(2);
  if (command === "help" || command === "--help") return process.stdout.write(help());
  const inputFile = argValue(args, "--input");
  const file = argValue(args, "--ledger") || DEFAULT_LEDGER_FILE;
  const input = inputFile ? JSON.parse(fs.readFileSync(inputFile, "utf8")) : {};
  let result;
  if (command === "init") result = { ok: true, ledger: dashboardData(file) };
  else if (command === "plan-create") result = createPlan(input, file);
  else if (command === "job-upsert") result = upsertJob(input, file);
  else if (command === "job-reserve") result = reserveJob(input, file);
  else if (command === "job-bind") result = bindAgent(input, file);
  else if (command === "job-transition") result = transitionJob(input, file);
  else if (command === "plan-transition") result = transitionPlan(input, file);
  else if (command === "read") result = dashboardData(file);
  else if (command === "snapshot") { const output = argValue(args, "--output"); if (!output) fail("snapshot requires --output <file>"); fs.writeFileSync(output, snapshotHtml(file), "utf8"); result = { ok: true, output: path.resolve(output) }; }
  else fail(`unknown command ${command}`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { process.stderr.write(`agent-jobs: ${error.message}\n`); process.exitCode = 1; }
}
