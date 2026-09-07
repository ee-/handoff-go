// Handoff Go Coder watch conformance test (mock harness, no LLM).
// Run: node tests/watch.test.mjs
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { parseInterval, parseWatchCommand, WATCH_DEFAULT_SECONDS, WATCH_NOT_ACTIVE, WATCH_RESTART_REQUIRED, WATCH_TICK_PROMPT } from "../skills/handoff-go/watch.mjs";
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
  const api = {
    on(event, h) { (handlers[event] ??= []).push(h); },
    sendMessage(msg, opts) { sent.push({ msg, opts }); return Promise.resolve(); },
  };
  const ctx = {
    ui: { notify: (msg) => notes.push(msg) },
    mode: "tui",
    cwd: "/tmp",
    isIdle: () => true,
    hasPendingMessages: () => false,
  };
  if (shape === "managed") {
    ctx.setInterval = (fn, ms) => { ctxIntervals.push({ fn, ms }); return 7000 + ctxIntervals.length; };
    ctx.clearTimer = (id) => { ctxCleared.push(id); };
  }
  return { api, ctx, handlers, sent, ctxIntervals, ctxCleared, notes, shape };
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

// ---- Durable-state fingerprint wake gate and watermark tests ----
{
  let currentFp = "fp_init";
  const probe = () => currentFp;
  const env = makeEnv("managed");
  watchAdapter(env.api, { probe });
  emit(env, "session_start", {});
  await emit(env, "input", { text: "go watch", source: "interactive" });
  assert.equal(env.sent.length, 1, "immediate first go runs");

  // Allow promise chain to settle and converge baseline to "fp_init"
  await new Promise((r) => setTimeout(r, 10));

  // Next ticks with same fingerprint -> dormant (no new turn)
  const tickFn = env.ctxIntervals[0].fn;
  tickFn();
  assert.equal(env.sent.length, 1, "same fingerprint -> no sendMessage (stays dormant)");
  tickFn();
  assert.equal(env.sent.length, 1, "repeated same fingerprint -> stays dormant");

  // Changed fingerprint -> wakes one normal go
  currentFp = "fp_changed";
  tickFn();
  assert.equal(env.sent.length, 2, "changed fingerprint -> wakes one normal go");

  // State changes DURING turn: wakeFp was "fp_changed", but before settle state moves to "fp_in_flight"
  currentFp = "fp_in_flight";
  await new Promise((r) => setTimeout(r, 10)); // settles with mismatch
  // Baseline did NOT converge to fp_in_flight; next tick must still wake
  tickFn();
  assert.equal(env.sent.length, 3, "state changed during turn -> next tick still wakes");
  await new Promise((r) => setTimeout(r, 10)); // settles

  // Stable before and after turn: wakeFp and settledFp match -> converges to dormant
  currentFp = "fp_stable";
  tickFn(); // wakes with fp_stable
  assert.equal(env.sent.length, 4, "wakes on change to fp_stable");
  await new Promise((r) => setTimeout(r, 10)); // settles with fp_stable -> converges
  tickFn(); // next tick with fp_stable
  assert.equal(env.sent.length, 4, "stable before/after -> converges and stays dormant");

  // Fail-open rule: probe returns null (error / auth / truncation) -> must wake
  currentFp = null;
  tickFn();
  assert.equal(env.sent.length, 5, "probe failure (null) -> fails open and wakes");
  await new Promise((r) => setTimeout(r, 10)); // settles

  // Stop -> no further wakes even if state changes
  await emit(env, "input", { text: "go watch stop", source: "interactive" });
  currentFp = "fp_new";
  tickFn();
  assert.equal(env.sent.length, 5, "stopped watcher does not wake on tick");
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
