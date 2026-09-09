// Handoff Go Coder watch conformance test (mock harness, no LLM).
// Run: node tests/watch.test.mjs
import assert from "node:assert/strict";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { parseInterval, parseWatchCommand, WATCH_ACTIVE, WATCH_BUSY, WATCH_DEFAULT_SECONDS, WATCH_NOT_ACTIVE, WATCH_PENDING_WAKE, WATCH_RESTART_REQUIRED, WATCH_SETTLING, WATCH_SLEEPING, WATCH_STATUS_KEY, WATCH_TICK_PROMPT, WATCH_WAKE } from "../skills/handoff-go/watch.mjs";
import watchAdapter, { getDurableStateFingerprint } from "../skills/handoff-go/adapters/watch.js";

// Patch global timers once so raw fallback timer usage (e.g. Pi) is observable.
const realSetInterval = globalThis.setInterval;
const realClearInterval = globalThis.clearInterval;
globalThis.__hgIntervals = [];
globalThis.__hgCleared = [];
globalThis.setInterval = (fn, ms) => { globalThis.__hgIntervals.push({ fn, ms }); return 5000 + globalThis.__hgIntervals.length; };
globalThis.clearInterval = (id) => { globalThis.__hgCleared.push(id); };

function makeEnv(shape = "managed") {
  const handlers = {};
  const sent = [];
  const ctxIntervals = [];
  const ctxCleared = [];
  const notes = [];
  const statuses = [];
  const api = {
    on(event, h) { (handlers[event] ??= []).push(h); },
    // Real OMP `pi.sendMessage(...)` returns void, not a completion promise.
    sendMessage(msg, opts) { sent.push({ msg, opts }); },
  };
  const ctx = {
    ui: {
      notify: (msg) => notes.push(msg),
      setStatus: (key, text) => statuses.push({ key, text }),
    },
    mode: "tui",
    cwd: "/tmp",
    isIdle: () => true,
    hasPendingMessages: () => false,
  };
  if (shape === "managed") {
    ctx.setInterval = (fn, ms) => { ctxIntervals.push({ fn, ms }); return 7000 + ctxIntervals.length; };
    ctx.clearTimer = (id) => { ctxCleared.push(id); };
  }
  return { api, ctx, handlers, sent, ctxIntervals, ctxCleared, notes, statuses, shape };
}

function emit(env, name, event) {
  let r;
  for (const h of env.handlers[name] ?? []) r = h(event, env.ctx);
  return r;
}

async function run(adapter, text, source = "interactive", opts = {}) {
  const env = makeEnv(opts.shape ?? "managed");
  adapter(env.api, opts);
  emit(env, "session_start", {});
  const inputResult = await emit(env, "input", { text, source });
  if (opts.shutdown !== false) emit(env, "session_shutdown", {});
  return { env, inputResult };
}

// Issue #44 helpers: activate a managed watcher, fire a native timer tick, emit
// a real OMP `agent_end` lifecycle event, and read the native status stream.
async function started(probe, opts = {}) {
  const env = makeEnv(opts.shape ?? "managed");
  watchAdapter(env.api, { probe, ...opts });
  emit(env, "session_start", {});
  await emit(env, "input", { text: "go watch", source: "interactive" });
  return env;
}
function tickFn(env, shape = "managed") {
  return shape === "managed" ? env.ctxIntervals.at(-1)?.fn : globalThis.__hgIntervals.at(-1)?.fn;
}
function agentEnd(env, extra = {}) {
  return emit(env, "agent_end", { type: "agent_end", messages: [], ...extra });
}
function statusLog(env) {
  return env.statuses.filter((s) => s.key === WATCH_STATUS_KEY).map((s) => s.text);
}

// ---- shared core ----
assert.equal(parseInterval(""), WATCH_DEFAULT_SECONDS, "default 60");
assert.equal(parseInterval("60s"), 60);
assert.equal(parseInterval("1m"), 60);
assert.equal(parseInterval("5m"), 300);
assert.equal(parseInterval("1h"), 3600);
assert.equal(parseInterval("30s"), null, "below 60 rejected");
assert.equal(parseInterval("59"), null, "below 60 rejected");
assert.equal(parseInterval("nonsense"), null, "invalid");
assert.deepEqual(parseWatchCommand("go watch"), { kind: "start", intervalSeconds: 60 });
assert.equal(parseWatchCommand("go watch 30s").invalid, true, "invalid interval");
assert.deepEqual(parseWatchCommand("go watch stop"), { kind: "stop" });
assert.equal(parseWatchCommand("go build").kind, "none");

// ---- canonical watch tick: minimal trigger, not a second protocol spec ----
assert.equal(
  WATCH_TICK_PROMPT,
  "Handoff Go Coder watch tick.\n\nReload trusted governance and run exactly one normal Coder `go` cycle.",
  "tick message is the minimal canonical trigger",
);
for (const dup of ["Security Gate", "NO_CODER_WORK", "precedence", "invent work", "immutable ref", "conversation context"]) {
  assert.ok(!WATCH_TICK_PROMPT.includes(dup), `tick must not restate governance: ${dup}`);
}

// ---- universal adapter in both host shapes (managed OMP vs raw Pi) ----
for (const shape of ["managed", "fallback"]) {
  const handled = { handled: true, action: "handled" };

  // Fields are on the EVENT, not the ctx: put them on ctx only -> no activation.
  const envOnlyCtx = makeEnv(shape);
  watchAdapter(envOnlyCtx.api);
  emit(envOnlyCtx, "session_start", {});
  const ctxOnlyResult = await emit(envOnlyCtx, "input", {}, { text: "go watch", source: "interactive" });
  emit(envOnlyCtx, "session_shutdown", {});
  assert.equal(envOnlyCtx.sent.length, 0, `${shape}: ctx-only fields do not activate`);
  assert.equal(ctxOnlyResult, undefined, `${shape}: ctx-only fields not handled`);

  // interactive event.text="go watch" activates + one immediate wake + consumed.
  const r = await run(watchAdapter, "go watch", "interactive", { shape, probe: () => "fp1" });
  assert.equal(r.env.sent.length, 1, `${shape}: exactly one immediate wake`);
  assert.ok(r.env.sent[0].msg.content.includes(WATCH_TICK_PROMPT.slice(0, 30)), `${shape}: tick prompt injected`);
  assert.deepEqual(r.inputResult, handled, `${shape}: recognized command consumed`);
  assert.equal(r.inputResult.handled, true, `${shape}: exposes handled: true for OMP`);
  assert.equal(r.inputResult.action, "handled", `${shape}: exposes action: handled for Pi`);

  if (shape === "managed") {
    assert.equal(r.env.ctxIntervals[0]?.ms, 60000, `${shape}: managed interval 60s`);
  } else {
    assert.equal(globalThis.__hgIntervals.at(-1)?.ms, 60000, `${shape}: fallback raw interval 60s`);
  }

  // custom interval >=60s
  const r2 = await run(watchAdapter, "go watch 5m", "interactive", { shape, probe: () => "fp1" });
  const im2 = shape === "managed" ? r2.env.ctxIntervals[0]?.ms : globalThis.__hgIntervals.at(-1)?.ms;
  assert.equal(im2, 300000, `${shape}: 5m interval`);

  // below-60s is rejected but consumed (no activation, still handled)
  const r3 = await run(watchAdapter, "go watch 30s", "interactive", { shape, probe: () => "fp1" });
  assert.deepEqual(r3.inputResult, handled, `${shape}: invalid interval consumed`);
  assert.equal(r3.env.sent.length, 0, `${shape}: invalid interval does not wake`);

  // event.source="extension" is NOT consumed and does NOT reactivate
  const r4 = await run(watchAdapter, "go watch", "extension", { shape, probe: () => "fp1" });
  assert.equal(r4.env.sent.length, 0, `${shape}: injected wake not re-activated`);
  assert.equal(r4.inputResult, undefined, `${shape}: injected wake continues normally`);

  // busy agent does not overlap
  const b = await run(watchAdapter, "go watch", "interactive", { shape, shutdown: false, probe: () => "changed-fp" });
  b.env.ctx.isIdle = () => false;
  const tickFn = shape === "managed" ? b.env.ctxIntervals[0]?.fn : globalThis.__hgIntervals.at(-1)?.fn;
  tickFn(); // fire tick while busy
  assert.equal(b.env.sent.length, 1, `${shape}: busy tick does not overlap`);

  // stop consumes and clears the timer
  const s = makeEnv(shape);
  watchAdapter(s.api, { probe: () => "fp1" });
  emit(s, "session_start", {});
  await emit(s, "input", { text: "go watch", source: "interactive" });
  const clearedBefore = shape === "managed" ? s.ctxCleared.length : globalThis.__hgCleared.length;
  const stopResult = await emit(s, "input", { text: "go watch stop", source: "interactive" });
  emit(s, "session_shutdown", {});
  assert.deepEqual(stopResult, handled, `${shape}: stop consumed`);
  const clearedAfter = shape === "managed" ? s.ctxCleared.length : globalThis.__hgCleared.length;
  assert.ok(clearedAfter > clearedBefore, `${shape}: stop clears timer`);
}

// ---- Durable-state fingerprint composition (real adapter parsing, local fake `gh`) ----
// AC-1 issue-comment-only, AC-2 PR-conversation-comment-only, AC-3 PR
// headRefOid, AC-12 pagination/API ambiguity -> unknown -> fail open.
{
  const bin = mkdtempSync(join(tmpdir(), "hg-fake-gh-"));
  const ghPath = join(bin, "gh");
  writeFileSync(ghPath, '#!/bin/sh\nprintf %s "$HG_FAKE_GH_JSON"\n');
  chmodSync(ghPath, 0o755);
  const oldPath = process.env.PATH;
  process.env.PATH = `${bin}:${oldPath}`;
  const fingerprintFor = (issues, prs, head = "head-1") => {
    process.env.HG_FAKE_GH_JSON = JSON.stringify({
      data: {
        repository: {
          defaultBranchRef: { target: { oid: head } },
          issues: { pageInfo: { hasNextPage: false }, nodes: issues },
          pullRequests: { pageInfo: { hasNextPage: false }, nodes: prs },
        },
      },
    });
    return getDurableStateFingerprint("/tmp");
  };
  try {
    const base = fingerprintFor([{ number: 1, updatedAt: "t1" }], [{ number: 2, updatedAt: "t2", headRefOid: "h2" }]);
    assert.equal(typeof base, "string", "fingerprint is composed from the exact GraphQL fields");
    assert.notEqual(
      fingerprintFor([{ number: 1, updatedAt: "t1-comment" }], [{ number: 2, updatedAt: "t2", headRefOid: "h2" }]),
      base,
      "AC-1: issue-comment-only update advances the fingerprint",
    );
    assert.notEqual(
      fingerprintFor([{ number: 1, updatedAt: "t1" }], [{ number: 2, updatedAt: "t2-comment", headRefOid: "h2" }]),
      base,
      "AC-2: PR-conversation-comment-only update advances the fingerprint",
    );
    assert.notEqual(
      fingerprintFor([{ number: 1, updatedAt: "t1" }], [{ number: 2, updatedAt: "t2", headRefOid: "h2-pushed" }]),
      base,
      "AC-3: PR headRefOid change advances the fingerprint",
    );
    assert.equal(
      fingerprintFor([{ number: 1, updatedAt: "t1" }], [{ number: 2, updatedAt: "t2", headRefOid: "h2" }]),
      base,
      "unchanged durable state is a stable fingerprint",
    );
    process.env.HG_FAKE_GH_JSON = JSON.stringify({
      data: {
        repository: {
          defaultBranchRef: { target: { oid: "head-1" } },
          issues: { pageInfo: { hasNextPage: true }, nodes: [] },
          pullRequests: { pageInfo: { hasNextPage: false }, nodes: [] },
        },
      },
    });
    assert.equal(getDurableStateFingerprint("/tmp"), null, "AC-12: pagination truncation -> unknown");
    process.env.HG_FAKE_GH_JSON = "not-json";
    assert.equal(getDurableStateFingerprint("/tmp"), null, "AC-12: API/parse failure -> unknown");
    delete process.env.HG_FAKE_GH_JSON;
    assert.equal(getDurableStateFingerprint("/tmp"), null, "AC-12: probe error -> unknown");
  } finally {
    process.env.PATH = oldPath;
    delete process.env.HG_FAKE_GH_JSON;
  }
}

// ---- Terminal settlement, watermark convergence, busy coalescing, status ----
// AC-4 one Coder wake on an active-PR route change; AC-5 Coder changes durable
// state during its own watch turn; AC-6 no convergence before native terminal
// completion; AC-7 exactly one settling rediscovery; AC-8 convergence after it;
// AC-9 subsequent dormancy; AC-10 busy coalescing; AC-11 second change during
// the active turn; AC-12 probe failure fails open; AC-14 truthful status.
{
  let fp = "A";
  const env = await started(() => fp);
  const tick = tickFn(env);
  assert.equal(env.sent.length, 1, "AC-4: activation performs one full Coder go");
  assert.deepEqual(statusLog(env), [WATCH_ACTIVE, WATCH_WAKE], "AC-14: activation publishes active then wake");

  // AC-6: while the watch-triggered Coder turn is running (host busy), ticks
  // must not converge the baseline or start a second turn.
  env.ctx.isIdle = () => false;
  tick();
  tick();
  assert.equal(env.sent.length, 1, "AC-6/AC-10: in-flight watch turn never overlaps");
  assert.equal(statusLog(env).at(-1), WATCH_WAKE, "AC-6: still in flight, not converged");

  // AC-5/AC-7: the turn terminally settles; the Coder changed durable state.
  fp = "B";
  env.ctx.isIdle = () => true;
  agentEnd(env);
  assert.equal(statusLog(env).at(-1), WATCH_SETTLING, "AC-7: changed settle requires a settling rediscovery");
  tick();
  assert.equal(env.sent.length, 2, "AC-7: exactly one settling rediscovery");
  assert.equal(statusLog(env).at(-1), WATCH_WAKE, "AC-7: the settling rediscovery is a real wake");
  env.ctx.isIdle = () => false; // the settling turn is running
  tick();
  assert.equal(env.sent.length, 2, "AC-7/AC-10: settling turn in flight, no overlap");

  // AC-8/AC-9: the settling turn sees stable state -> converges -> dormant.
  env.ctx.isIdle = () => true;
  agentEnd(env);
  assert.equal(statusLog(env).at(-1), WATCH_SLEEPING, "AC-8: stable settle converges the watermark");
  const statusCalls = env.statuses.length;
  tick();
  tick();
  tick();
  assert.equal(env.sent.length, 2, "AC-9: unchanged durable state stays dormant");
  assert.equal(env.statuses.length, statusCalls, "AC-14: dormant ticks do not spam status");

  // AC-12: probe ambiguity fails open (one wake) and never converges the baseline.
  fp = null;
  tick();
  assert.equal(env.sent.length, 3, "AC-12: unknown probe fails open");
  agentEnd(env);
  assert.equal(statusLog(env).at(-1), WATCH_SETTLING, "AC-12: unknown settle never converges");
  fp = "A";
  tick();
  assert.equal(env.sent.length, 4, "AC-12: the settling rediscovery still runs");
  agentEnd(env);
  assert.equal(statusLog(env).at(-1), WATCH_SLEEPING, "recovered probe converges after a full rediscovery");
}

// AC-10: a busy host coalesces to at most one pending wake; unchanged busy
// ticks only publish WATCH_BUSY and never wake the model.
{
  let fp = "A";
  const env = await started(() => fp);
  const tick = tickFn(env);
  agentEnd(env); // wakeFp A == settledFp A -> converged
  assert.equal(statusLog(env).at(-1), WATCH_SLEEPING, "converged before the busy test");

  env.ctx.isIdle = () => false;
  tick();
  assert.equal(env.sent.length, 1, "AC-10: unchanged busy tick never wakes");
  assert.equal(statusLog(env).at(-1), WATCH_BUSY, "AC-14: busy + unchanged publishes WATCH_BUSY");

  fp = "B";
  tick();
  tick();
  tick();
  assert.equal(env.sent.length, 1, "AC-10: busy changes coalesce, never one wake per tick");
  assert.equal(statusLog(env).at(-1), WATCH_PENDING_WAKE, "AC-14: coalesced wake is observable");

  env.ctx.isIdle = () => true;
  tick();
  assert.equal(env.sent.length, 2, "AC-10: exactly one coalesced wake drains when idle");
  assert.equal(statusLog(env).at(-1), WATCH_WAKE, "AC-14: drained wake is a real wake");
}

// AC-11: a second durable change arriving while the first Coder turn is active
// is observed by one full subsequent rediscovery.
{
  let fp = "A";
  const env = await started(() => fp);
  const tick = tickFn(env);
  fp = "B"; // second change during the active watch turn
  agentEnd(env);
  assert.equal(statusLog(env).at(-1), WATCH_SETTLING, "AC-11: active-turn change forces a rediscovery");
  tick();
  assert.equal(env.sent.length, 2, "AC-11: exactly one full rediscovery observes the change");
}

// Non-terminal agent_end (scheduled auto-retry / continuation) must not settle.
{
  let fp = "A";
  const env = await started(() => fp);
  fp = "B";
  agentEnd(env, { willContinue: true });
  assert.equal(statusLog(env).at(-1), WATCH_WAKE, "non-terminal agent_end does not settle");
  assert.equal(env.sent.length, 1, "non-terminal agent_end does not wake");
  agentEnd(env);
  assert.equal(statusLog(env).at(-1), WATCH_SETTLING, "terminal agent_end settles");
}

// A queued wake that has not started must not settle, and an unrelated turn
// with no wake in flight must not touch the watermark.
{
  let fp = "A";
  const env = await started(() => fp);
  const tick = tickFn(env);
  agentEnd(env);
  assert.equal(statusLog(env).at(-1), WATCH_SLEEPING, "converged");
  agentEnd(env); // unrelated terminal turn, no wake in flight
  assert.equal(statusLog(env).at(-1), WATCH_SLEEPING, "unrelated terminal turn is ignored");

  fp = "B";
  tick();
  assert.equal(env.sent.length, 2, "changed state wakes");
  fp = "C"; // the watch turn writes durable state
  env.ctx.hasPendingMessages = () => true; // the follow-up wake is still queued
  agentEnd(env);
  assert.equal(statusLog(env).at(-1), WATCH_WAKE, "queued wake has not started: no settle");
  env.ctx.hasPendingMessages = () => false;
  agentEnd(env);
  assert.equal(statusLog(env).at(-1), WATCH_SETTLING, "settle resumes once the wake really ran");
}

// Bounded fallback: a host that never emits a terminal agent_end settles on a
// tick only when the session is idle with nothing queued.
{
  let fp = "A";
  const env = await started(() => fp);
  const tick = tickFn(env);
  env.ctx.isIdle = () => false;
  fp = "B";
  tick();
  assert.equal(env.sent.length, 1, "in-flight busy tick does not settle or wake");
  env.ctx.isIdle = () => true;
  tick();
  assert.equal(statusLog(env).at(-1), WATCH_SETTLING, "idle tick fallback settles");
  tick();
  assert.equal(env.sent.length, 2, "fallback still yields exactly one settling rediscovery");
}

// AC-14: stop clears the native status surface.
{
  const env = await started(() => "A");
  await emit(env, "input", { text: "go watch stop", source: "interactive" });
  assert.equal(statusLog(env).at(-1), undefined, "stop clears the runtime status");
}

// Stop -> no further wakes even if durable state changes.
{
  let fp = "A";
  const env = await started(() => fp);
  const tick = tickFn(env);
  await emit(env, "input", { text: "go watch stop", source: "interactive" });
  fp = "B";
  tick();
  assert.equal(env.sent.length, 1, "stopped watcher does not wake on tick");
}

// ---- Activation lifecycle: disk vs loaded vs active (Issue #33 AC-1/2/5) ----
{
  // State 1, "on disk": files copied into a harness layout change nothing in
  // any process. No adapter was instantiated, so no input hooks, timers, or
  // wakes exist anywhere; the only truthful model-visible outcome for
  // `go watch` is the canonical restart-required text, never an active claim.
  assert.match(WATCH_RESTART_REQUIRED, /^WATCH_RESTART_REQUIRED\n/);
  assert.match(WATCH_RESTART_REQUIRED, /nothing was scheduled and nothing is active/);
  assert.match(WATCH_RESTART_REQUIRED, /restart/);
  assert.doesNotMatch(WATCH_RESTART_REQUIRED, /watch (is )?active/);

  // State 2, "loaded but never started": the extension is in the process, but
  // stop must not invent an active watcher (AC-5): the canonical
  // WATCH_NOT_ACTIVE outcome is reported instead of a false "stopped".
  const never = makeEnv("managed");
  watchAdapter(never.api, { probe: () => "fp1" });
  emit(never, "session_start", {});
  const stopBefore = await emit(never, "input", { text: "go watch stop", source: "interactive" });
  assert.deepEqual(stopBefore, { handled: true, action: "handled" }, "stop is consumed");
  assert.equal(never.notes.at(-1), WATCH_NOT_ACTIVE, "never-started stop reports WATCH_NOT_ACTIVE");
  assert.equal(never.ctxIntervals.length, 0, "never-started stop creates no timer");
  assert.equal(never.ctxCleared.length, 0, "never-started stop clears no timer");
  assert.equal(never.sent.length, 0, "never-started stop wakes nothing");

  // State 3, "active": only native interception + start() creates the timer
  // and performs the immediate discovery. The stop after a real start reports
  // the genuine stopped notification (not WATCH_NOT_ACTIVE).
  const started = makeEnv("managed");
  watchAdapter(started.api, { probe: () => "fp1" });
  emit(started, "session_start", {});
  await emit(started, "input", { text: "go watch", source: "interactive" });
  assert.equal(started.ctxIntervals.length, 1, "activation creates exactly one timer");
  assert.equal(started.sent.length, 1, "activation performs the immediate discovery");
  emit(started, "input", { text: "go watch stop", source: "interactive" });
  assert.ok(started.notes.includes("Handoff Go watch stopped"), "genuine stop reports stopped");
  assert.ok(!started.notes.includes(WATCH_NOT_ACTIVE), "genuine stop is not reported as never-active");
  // After stop the watcher is dead: a later stop reports WATCH_NOT_ACTIVE.
  emit(started, "input", { text: "go watch stop", source: "interactive" });
  assert.equal(started.notes.at(-1), WATCH_NOT_ACTIVE, "second stop after stopping reports not-active");
}

// Reachability: universal adapter `import "../watch.mjs"` from `.omp/extensions/`
// and `.pi/extensions/` resolves to `.omp/watch.mjs` and `.pi/watch.mjs`.
const reachRoot = mkdtempSync(join(tmpdir(), "hgwatch-"));
const reachCopy = (from, to) => cpSync(join(process.cwd(), from), join(reachRoot, to), { recursive: true });
mkdirSync(join(reachRoot, ".omp/extensions"), { recursive: true });
mkdirSync(join(reachRoot, ".pi/extensions"), { recursive: true });
reachCopy("skills/handoff-go/adapters/watch.js", ".omp/extensions/handoff-go-watch.js");
reachCopy("skills/handoff-go/adapters/watch.js", ".pi/extensions/handoff-go-watch.js");
reachCopy("skills/handoff-go/watch.mjs", ".omp/watch.mjs");
reachCopy("skills/handoff-go/watch.mjs", ".pi/watch.mjs");
const ompMod = await import(pathToFileURL(join(reachRoot, ".omp/extensions/handoff-go-watch.js")));
const piMod = await import(pathToFileURL(join(reachRoot, ".pi/extensions/handoff-go-watch.js")));
assert.equal(typeof ompMod.default, "function", "OMP universal adapter loads and exports a factory");
assert.equal(typeof piMod.default, "function", "Pi universal adapter loads and exports a factory");

// ---- Managed AGENTS.md block parser tests (Issue #7) ----
function parseManagedBlock(content) {
  const startMarker = "<!-- handoff-go:start -->";
  const endMarker = "<!-- handoff-go:end -->";

  const startCount = (content.match(new RegExp(startMarker, "g")) || []).length;
  const endCount = (content.match(new RegExp(endMarker, "g")) || []).length;
  if (startCount !== 1 || endCount !== 1) {
    throw new Error(`Expected exactly one managed block, found start=${startCount} end=${endCount}`);
  }
  const s = content.indexOf(startMarker);
  const e = content.indexOf(endMarker);
  if (s === -1 || e === -1 || s >= e) {
    throw new Error("Malformed or inverted managed block markers");
  }
  const block = content.slice(s + startMarker.length, e);

  const skillMatches = [...block.matchAll(/^[ \t]*-[ \t]*Skill:[ \t]*(.+)$/gm)].map(m => m[1].trim().replace(/^[`"'\x27]+|[`"'\x27]+$/g, ""));
  if (skillMatches.length !== 1) {
    throw new Error(`Expected exactly one Skill entry in managed block, found ${skillMatches.length}`);
  }
  const skillPath = skillMatches[0];
  if (!skillPath || skillPath.startsWith("/") || skillPath.includes("..")) {
    throw new Error(`Malformed or escaping Skill path: ${skillPath}`);
  }

  const refMatches = [...block.matchAll(/^[ \t]*-[ \t]*Immutable ref:[ \t]*(.+)$/gm)].map(m => m[1].trim());
  if (refMatches.length !== 1) {
    throw new Error(`Expected exactly one Immutable ref entry in managed block, found ${refMatches.length}`);
  }
  const immutableRef = refMatches[0];
  if (!immutableRef) {
    throw new Error("Empty Immutable ref in managed block");
  }

  let skillDir = skillPath;
  if (skillPath.endsWith(".md") || skillPath.endsWith(".mjs") || skillPath.endsWith(".js")) {
    skillDir = dirname(skillPath);
  }
  return { skillDir, skillPath, immutableRef };
}

const realAgents = readFileSync("AGENTS.md", "utf8");

// valid one block + one Skill -> PASS
const rBlock = parseManagedBlock(realAgents);
assert.equal(rBlock.skillDir, "skills/handoff-go", "valid one block + one Skill -> PASS");

// unrelated Skill before block -> correct Handoff Go Skill
const rUnrelated = parseManagedBlock("- Skill: `unrelated/path.md`\n" + realAgents);
assert.equal(rUnrelated.skillDir, "skills/handoff-go", "unrelated Skill before block -> correct Handoff Go Skill");

// missing managed block -> FAIL
assert.throws(() => parseManagedBlock("no markers here"), /Expected exactly one managed block/);

// duplicate managed blocks -> FAIL
assert.throws(() => parseManagedBlock(realAgents + "\n" + realAgents), /Expected exactly one managed block/);

// duplicate Skill in block -> FAIL
const dupSkillContent = realAgents.replace(/^[ \t]*-[ \t]*Skill:.*$/m, "- Skill: `a/SKILL.md`\n- Skill: `b/SKILL.md`");
assert.throws(() => parseManagedBlock(dupSkillContent), /Expected exactly one Skill entry/);

// restore timers
globalThis.setInterval = realSetInterval;
globalThis.clearInterval = realClearInterval;

console.log("watch conformance: PASS");
