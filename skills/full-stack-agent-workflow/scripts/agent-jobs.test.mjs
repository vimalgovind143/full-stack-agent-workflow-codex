import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createPlan, upsertJob, reserveJob, bindAgent, transitionJob, transitionPlan, dashboardData, readLedger } from "./agent-jobs.mjs";

const files = [];
function ledgerFile() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-jobs-")); files.push(dir); return path.join(dir, "agent-jobs.json"); }
afterEach(() => files.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function setup(file) { const plan = createPlan({ id: "plan", title: "Plan", orchestrator: "lead", orchestratorToken: "orch" }, file); return { ...plan, file }; }
function job(file, values = {}) { return upsertJob({ id: "job", planId: "plan", title: "Job", canonicalKey: "console agent ledger", model: "gpt-6.1-sol", dependencies: [], writeResources: ["D:\\GitHub\\amthal-workspace\\workspace-console\\agent-jobs.mjs"], orchestrator: "lead", orchestratorToken: "orch", ...values }, file); }
function reserve(file, values = {}) { return reserveJob({ orchestrator: "lead", orchestratorToken: "orch", ...values }, file); }

test("rejects Astra and duplicate active canonical keys", () => {
  const { file } = setup(ledgerFile());
  assert.throws(() => job(file, { model: "gpt-6-astra" }), /Astra is not permitted/);
  job(file);
  assert.throws(() => job(file, { id: "job-2", canonicalKey: "CONSOLE   agent ledger", writeResources: ["D:\\other\\elsewhere.txt"] }), /canonicalKey/);
});
test("allows planned overlap but rejects a competing reservation on a parent path", () => {
  const { file } = setup(ledgerFile()); job(file); reserve(file, { id: "job", owner: "one" });
  job(file, { id: "job-2", canonicalKey: "other", writeResources: ["D:\\GitHub\\amthal-workspace\\workspace-console"] });
  assert.throws(() => reserve(file, { id: "job-2", owner: "two" }), /overlap/);
});
test("requires completed dependencies before atomic reservation", () => {
  const { file } = setup(ledgerFile()); job(file);
  job(file, { id: "child", canonicalKey: "child", dependencies: ["job"], writeResources: ["D:\\other\\child.txt"] });
  assert.throws(() => reserve(file, { id: "child", owner: "worker" }, file), /dependency/);
});
test("competing reservations produce exactly one winner", async () => {
  const { file } = setup(ledgerFile()); job(file);
  const results = await Promise.allSettled([Promise.resolve().then(() => reserve(file, { id: "job", owner: "one" }, file)), Promise.resolve().then(() => reserve(file, { id: "job", owner: "two" }, file))]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(readLedger(file).jobs[0].status, "reserved");
});
test("enforces worker ownership, bound start, report review, and separate orchestration completion", () => {
  const { file } = setup(ledgerFile()); job(file);
  const { runToken } = reserve(file, { id: "job", owner: "worker" }, file);
  assert.throws(() => transitionJob({ id: "job", action: "start", owner: "worker", runToken }, file), /bound/);
  bindAgent({ id: "job", owner: "worker", runToken, agentId: "agent-1" }, file);
  assert.throws(() => transitionJob({ id: "job", action: "start", owner: "other", runToken }, file), /not authorized/);
  transitionJob({ id: "job", action: "start", owner: "worker", runToken }, file);
  assert.throws(() => transitionJob({ id: "job", action: "complete", orchestrator: "lead", orchestratorToken: "orch", outcome: "ok", stopConfirmed: true }, file), /review/);
  transitionJob({ id: "job", action: "report", owner: "worker", runToken, report: "tests pass" }, file);
  assert.throws(() => transitionJob({ id: "job", action: "complete", orchestrator: "lead", orchestratorToken: "wrong", outcome: "ok", stopConfirmed: true }, file), /not authorized/);
  transitionJob({ id: "job", action: "complete", orchestrator: "lead", orchestratorToken: "orch", outcome: "accepted", stopConfirmed: true }, file);
  assert.equal(readLedger(file).jobs[0].status, "completed");
});
test("blocked and review locks require explicit stop confirmation before release", () => {
  const { file } = setup(ledgerFile()); job(file);
  const { runToken } = reserve(file, { id: "job", owner: "worker" }, file);
  bindAgent({ id: "job", owner: "worker", runToken, agentId: "agent-1" }, file);
  transitionJob({ id: "job", action: "start", owner: "worker", runToken }, file);
  transitionJob({ id: "job", action: "block", owner: "worker", runToken, outcome: "waiting" }, file);
  assert.throws(() => transitionJob({ id: "job", action: "cancel", owner: "worker", runToken, outcome: "quit" }, file), /stopConfirmed/);
  transitionJob({ id: "job", action: "cancel", owner: "worker", runToken, outcome: "stopped", stopConfirmed: true }, file);
  assert.equal(readLedger(file).jobs[0].status, "cancelled");
});

test("dashboard data redacts worker and orchestrator capabilities", () => {
  const { file } = setup(ledgerFile()); job(file);
  const { runToken } = reserve(file, { id: "job", owner: "worker" });
  const text = JSON.stringify(dashboardData(file));
  assert.equal(text.includes(runToken), false);
  assert.equal(text.includes("orchestratorTokenHash"), false);
  assert.equal(text.includes("TokenHash"), false);
});
test("plan closure rejects unfinished jobs and workers cannot dispatch", () => {
  const { file } = setup(ledgerFile()); job(file);
  assert.throws(() => transitionPlan({ id: "plan", action: "complete", orchestrator: "lead", orchestratorToken: "orch" }, file), /terminal/);
  assert.throws(() => upsertJob({ id: "other", planId: "plan", title: "Other", canonicalKey: "other", model: "gpt-6.1-sol", dependencies: [], writeResources: [], orchestrator: "worker", orchestratorToken: "no" }, file), /not authorized/);
});
test("separate child processes contend on the exclusive reservation lock", async () => {
  const { file } = setup(ledgerFile()); job(file);
  const inputs = ["one", "two"].map((owner) => { const input = path.join(path.dirname(file), `${owner}.json`); fs.writeFileSync(input, JSON.stringify({ id: "job", owner, orchestrator: "lead", orchestratorToken: "orch" })); return input; });
  const cli = fileURLToPath(new URL("./agent-jobs.mjs", import.meta.url));
  const run = (input) => new Promise((resolve) => { const child = spawn(process.execPath, [cli, "job-reserve", "--input", input, "--ledger", file]); child.on("close", (code) => resolve(code)); });
  const codes = await Promise.all(inputs.map(run));
  assert.equal(codes.filter((code) => code === 0).length, 1);
});
test("orchestrator may bind and perform worker lifecycle actions without a run token", () => {
  const { file } = setup(ledgerFile()); job(file);
  reserve(file, { id: "job", owner: "worker" }, file);
  bindAgent({ id: "job", agentId: "agent-1", orchestrator: "lead", orchestratorToken: "orch", evidence: "spawn response" }, file);
  transitionJob({ id: "job", action: "start", orchestrator: "lead", orchestratorToken: "orch" }, file);
  transitionJob({ id: "job", action: "progress", orchestrator: "lead", orchestratorToken: "orch", report: "working" }, file);
  transitionJob({ id: "job", action: "report", orchestrator: "lead", orchestratorToken: "orch", report: "done", reference: "worker message" }, file);
  const saved = readLedger(file).jobs[0];
  assert.equal(saved.status, "review");
  assert.equal(saved.history.at(-1).actor.role, "orchestrator");
  assert.equal(saved.history.at(-1).reference, "worker message");
});
test("invalid orchestrator credentials never fall back to a worker token", () => {
  const { file } = setup(ledgerFile()); job(file);
  const { runToken } = reserve(file, { id: "job", owner: "worker" }, file);
  assert.throws(() => bindAgent({ id: "job", owner: "worker", runToken, agentId: "agent-1", orchestrator: "lead", orchestratorToken: "wrong" }, file), /not authorized/);
  bindAgent({ id: "job", owner: "worker", runToken, agentId: "agent-1" }, file);
});
test("review corrections preserve the job id, reports, and audit history", () => {
  const { file } = setup(ledgerFile()); job(file);
  const { runToken } = reserve(file, { id: "job", owner: "worker" }, file);
  bindAgent({ id: "job", owner: "worker", runToken, agentId: "agent-1" }, file);
  transitionJob({ id: "job", action: "start", owner: "worker", runToken }, file);
  transitionJob({ id: "job", action: "report", owner: "worker", runToken, report: "first report" }, file);
  transitionJob({ id: "job", action: "review-block", orchestrator: "lead", orchestratorToken: "orch", outcome: "fix needed", reference: "review note" }, file);
  transitionJob({ id: "job", action: "resume", owner: "worker", runToken }, file);
  transitionJob({ id: "job", action: "report", owner: "worker", runToken, report: "corrected report" }, file);
  const saved = readLedger(file).jobs[0];
  assert.equal(saved.id, "job");
  assert.deepEqual(saved.reports.map((report) => report.report), ["first report", "corrected report"]);
  assert.deepEqual(saved.history.map((entry) => entry.action), ["bind", "start", "report", "review-block", "resume", "report"]);
});
test("audit history omits credentials and hashes", () => {
  const { file } = setup(ledgerFile()); job(file);
  const { runToken } = reserve(file, { id: "job", owner: "worker" });
  bindAgent({ id: "job", owner: "worker", runToken, agentId: "agent-1", evidence: "spawned" }, file);
  const history = JSON.stringify(readLedger(file).jobs[0].history);
  assert.equal(history.includes(runToken), false);
  assert.equal(history.includes("Hash"), false);
});
test("plan closure requires completion evidence and a waiver for unsuccessful terminal jobs", () => {
  const { file } = setup(ledgerFile()); job(file);
  transitionJob({ id: "job", action: "cancel", orchestrator: "lead", orchestratorToken: "orch", outcome: "scope removed" }, file);
  assert.throws(() => transitionPlan({ id: "plan", action: "complete", orchestrator: "lead", orchestratorToken: "orch", completionEvidence: "reviewed" }, file), /terminalWaiver/);
  assert.throws(() => transitionPlan({ id: "plan", action: "complete", orchestrator: "lead", orchestratorToken: "orch", terminalWaiver: "approved exception" }, file), /completionEvidence/);
  transitionPlan({ id: "plan", action: "complete", orchestrator: "lead", orchestratorToken: "orch", completionEvidence: "reviewed", terminalWaiver: "approved exception" }, file);
  const plan = readLedger(file).plans[0];
  assert.equal(plan.completionEvidence, "reviewed");
  assert.equal(plan.terminalWaiver, "approved exception");
});
test("plan acceptance criteria are optional", () => {
  const file = ledgerFile();
  createPlan({ id: "criteria", title: "Criteria", orchestrator: "lead", orchestratorToken: "orch", acceptanceCriteria: "All checks pass" }, file);
  assert.equal(readLedger(file).plans[0].acceptanceCriteria, "All checks pass");
});

test("a legacy job report is retained when a correction is reported", () => {
  const { file } = setup(ledgerFile()); job(file);
  const { runToken } = reserve(file, { id: "job", owner: "worker" }, file);
  bindAgent({ id: "job", owner: "worker", runToken, agentId: "agent-1" }, file);
  transitionJob({ id: "job", action: "start", owner: "worker", runToken }, file);
  transitionJob({ id: "job", action: "report", owner: "worker", runToken, report: "original" }, file);
  const ledger = readLedger(file); delete ledger.jobs[0].reports; fs.writeFileSync(file, JSON.stringify(ledger));
  transitionJob({ id: "job", action: "review-block", orchestrator: "lead", orchestratorToken: "orch", outcome: "revise" }, file);
  transitionJob({ id: "job", action: "resume", owner: "worker", runToken }, file);
  transitionJob({ id: "job", action: "report", owner: "worker", runToken, report: "revised" }, file);
  assert.deepEqual(readLedger(file).jobs[0].reports.map((report) => report.report), ["original", "revised"]);
});


test("POSIX parent scopes block child reservations without prefix false positives", () => {
  const { file } = setup(ledgerFile());
  job(file, {writeResources:["/Users/test/project/src/"]});
  reserve(file,{id:"job",owner:"one"});
  job(file,{id:"posix-child",canonicalKey:"posix child",writeResources:["/Users/test/project/src/file.mjs"]});
  assert.throws(()=>reserve(file,{id:"posix-child",owner:"two"}),/overlap/);
  job(file,{id:"posix-sibling",canonicalKey:"posix sibling",writeResources:["/Users/test/project/src-other/file.mjs"]});
  reserve(file,{id:"posix-sibling",owner:"three"});
});
