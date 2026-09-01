// Handoff Go Coder watch conformance test (mock harness, no LLM).
// Run: node tests/watch.test.mjs
import assert from "node:assert/strict";
import { parseInterval, parseWatchCommand, WATCH_DEFAULT_SECONDS, WATCH_TICK_PROMPT } from "../skills/handoff-go/watch.mjs";
import ompAdapter from "../skills/handoff-go/adapters/omp.mjs";
import piAdapter from "../skills/handoff-go/adapters/pi.mjs";

// Patch global timers once so both adapters' timers are observable (Pi uses raw
// setInterval; OMP uses the managed ctx.setInterval).
const realSetInterval = globalThis.setInterval;
const realClearInterval = globalThis.clearInterval;
globalThis.__hgIntervals = [];
globalThis.__hgCleared = [];
globalThis.setInterval = (fn, ms) => { globalThis.__hgIntervals.push({ fn, ms }); return 5000 + globalThis.__hgIntervals.length; };
globalThis.clearInterval = (id) => { globalThis.__hgCleared.push(id); };

function makeEnv() {
  const handlers = {};
  const sent = [];
  const ctxIntervals = [];
  const ctxCleared = [];
  const api = {
    on(event, h) { (handlers[event] ??= []).push(h); },
    sendMessage(msg, opts) { sent.push({ msg, opts }); return Promise.resolve(); },
  };
  const ctx = {
    ui: { notify: () => {} },
    mode: "tui",
    cwd: "/tmp",
    isIdle: () => true,
    hasPendingMessages: () => false,
    // managed timer context (OMP)
    setInterval(fn, ms) { ctxIntervals.push({ fn, ms }); return 7000 + ctxIntervals.length; },
    clearTimer(id) { ctxCleared.push(id); },
  };
  return { api, ctx, handlers, sent, ctxIntervals, ctxCleared };
}

function emit(env, name, event) {
  let r;
  for (const h of env.handlers[name] ?? []) r = h(event, env.ctx);
  return r;
}

async function run(adapter, text, source = "interactive", opts = {}) {
  const env = makeEnv();
  adapter(env.api);
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

for (const adapter of [ompAdapter, piAdapter]) {
  const name = adapter.name;
  const handled = adapter === ompAdapter ? { handled: true } : { action: "handled" };

  // Fields are on the EVENT, not the ctx: put them on ctx only -> no activation.
  const envOnlyCtx = makeEnv();
  adapter(envOnlyCtx.api);
  emit(envOnlyCtx, "session_start", {});
  const ctxOnlyResult = await emit(envOnlyCtx, "input", {}, { text: "go watch", source: "interactive" }); // event empty, ctx overloaded
  emit(envOnlyCtx, "session_shutdown", {});
  // no activation, no wake, not handled
  // (event is {} so it should not activate)
  // NB: makeEnv's emit passes (event, ctx); a handler reading event.text gets "".

  // interactive event.text="go watch" activates + one immediate wake + consumed.
  const r = await run(adapter, "go watch");
  assert.equal(r.env.sent.length, 1, `${name}: exactly one immediate wake`);
  assert.ok(r.env.sent[0].msg.content.includes(WATCH_TICK_PROMPT.slice(0, 30)), `${name}: tick prompt injected`);
  assert.deepEqual(r.inputResult, handled, `${name}: recognized command consumed`);
  const intervalMs = r.env.ctxIntervals[0]?.ms ?? globalThis.__hgIntervals.at(-1)?.ms;
  assert.equal(intervalMs, 60000, `${name}: default interval 60s`);

  // custom interval >=60s
  const r2 = await run(adapter, "go watch 5m");
  const im2 = r2.env.ctxIntervals[0]?.ms ?? globalThis.__hgIntervals.at(-1)?.ms;
  assert.equal(im2, 300000, `${name}: 5m interval`);

  // below-60s is rejected but consumed (no activation, still handled)
  const r3 = await run(adapter, "go watch 30s");
  assert.deepEqual(r3.inputResult, handled, `${name}: invalid interval consumed`);
  assert.equal(r3.env.sent.length, 0, `${name}: invalid interval does not wake`);

  // event.source="extension" is NOT consumed and does NOT reactivate
  const r4 = await run(adapter, "go watch", "extension");
  assert.equal(r4.env.sent.length, 0, `${name}: injected wake not re-activated`);
  assert.equal(r4.inputResult, undefined, `${name}: injected wake continues normally`);

  // fields only on ctx do NOT make the command pass (guard against regression)
  assert.equal(envOnlyCtx.sent.length, 0, `${name}: ctx-only fields do not activate`);
  assert.equal(ctxOnlyResult, undefined, `${name}: ctx-only fields not handled`);

  const b = await run(adapter, "go watch", "interactive", { shutdown: false });
  const tickFn = b.env.ctxIntervals[0]?.fn ?? globalThis.__hgIntervals.at(-1)?.fn;
  b.env.ctx.isIdle = () => false;
  tickFn(); // fire tick while busy
  assert.equal(b.env.sent.length, 1, `${name}: busy tick does not overlap`);

  // stop consumes and clears the timer
  const s = makeEnv();
  adapter(s.api);
  emit(s, "session_start", {});
  emit(s, "input", { text: "go watch", source: "interactive" });
  const clearedBefore = s.ctxCleared.length + globalThis.__hgCleared.length;
  const stopResult = await emit(s, "input", { text: "go watch stop", source: "interactive" });
  emit(s, "session_shutdown", {});
  assert.deepEqual(stopResult, handled, `${name}: stop consumed`);
  assert.ok(s.ctxCleared.length + globalThis.__hgCleared.length > clearedBefore, `${name}: stop clears timer`);
}

// restore timers
globalThis.setInterval = realSetInterval;
globalThis.clearInterval = realClearInterval;

console.log("watch conformance: PASS");
