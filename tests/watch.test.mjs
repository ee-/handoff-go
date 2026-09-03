// Handoff Go Coder watch conformance test (mock harness, no LLM).
// Run: node tests/watch.test.mjs
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseInterval, parseWatchCommand, WATCH_DEFAULT_SECONDS, WATCH_TICK_PROMPT } from "../skills/handoff-go/watch.mjs";
import watchAdapter from "../skills/handoff-go/adapters/watch.mjs";

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
  };
  if (shape === "managed") {
    ctx.setInterval = (fn, ms) => { ctxIntervals.push({ fn, ms }); return 7000 + ctxIntervals.length; };
    ctx.clearTimer = (id) => { ctxCleared.push(id); };
  }
  return { api, ctx, handlers, sent, ctxIntervals, ctxCleared, shape };
}

function emit(env, name, event) {
  let r;
  for (const h of env.handlers[name] ?? []) r = h(event, env.ctx);
  return r;
}

async function run(adapter, text, source = "interactive", opts = {}) {
  const env = makeEnv(opts.shape ?? "managed");
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
  const r = await run(watchAdapter, "go watch", "interactive", { shape });
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
  const r2 = await run(watchAdapter, "go watch 5m", "interactive", { shape });
  const im2 = shape === "managed" ? r2.env.ctxIntervals[0]?.ms : globalThis.__hgIntervals.at(-1)?.ms;
  assert.equal(im2, 300000, `${shape}: 5m interval`);

  // below-60s is rejected but consumed (no activation, still handled)
  const r3 = await run(watchAdapter, "go watch 30s", "interactive", { shape });
  assert.deepEqual(r3.inputResult, handled, `${shape}: invalid interval consumed`);
  assert.equal(r3.env.sent.length, 0, `${shape}: invalid interval does not wake`);

  // event.source="extension" is NOT consumed and does NOT reactivate
  const r4 = await run(watchAdapter, "go watch", "extension", { shape });
  assert.equal(r4.env.sent.length, 0, `${shape}: injected wake not re-activated`);
  assert.equal(r4.inputResult, undefined, `${shape}: injected wake continues normally`);

  // busy agent does not overlap
  const b = await run(watchAdapter, "go watch", "interactive", { shape, shutdown: false });
  const tickFn = shape === "managed" ? b.env.ctxIntervals[0]?.fn : globalThis.__hgIntervals.at(-1)?.fn;
  b.env.ctx.isIdle = () => false;
  tickFn(); // fire tick while busy
  assert.equal(b.env.sent.length, 1, `${shape}: busy tick does not overlap`);

  // stop consumes and clears the timer
  const s = makeEnv(shape);
  watchAdapter(s.api);
  emit(s, "session_start", {});
  await emit(s, "input", { text: "go watch", source: "interactive" });
  const clearedBefore = shape === "managed" ? s.ctxCleared.length : globalThis.__hgCleared.length;
  const stopResult = await emit(s, "input", { text: "go watch stop", source: "interactive" });
  emit(s, "session_shutdown", {});
  assert.deepEqual(stopResult, handled, `${shape}: stop consumed`);
  const clearedAfter = shape === "managed" ? s.ctxCleared.length : globalThis.__hgCleared.length;
  assert.ok(clearedAfter > clearedBefore, `${shape}: stop clears timer`);
}

// Reachability: universal adapter `import "../watch.mjs"` from `.omp/extensions/`
// and `.pi/extensions/` resolves to `.omp/watch.mjs` and `.pi/watch.mjs`.
const reachRoot = mkdtempSync(join(tmpdir(), "hgwatch-"));
const reachCopy = (from, to) => cpSync(join(process.cwd(), from), join(reachRoot, to), { recursive: true });
mkdirSync(join(reachRoot, ".omp/extensions"), { recursive: true });
mkdirSync(join(reachRoot, ".pi/extensions"), { recursive: true });
reachCopy("skills/handoff-go/adapters/watch.mjs", ".omp/extensions/handoff-go-watch.mjs");
reachCopy("skills/handoff-go/adapters/watch.mjs", ".pi/extensions/handoff-go-watch.mjs");
reachCopy("skills/handoff-go/watch.mjs", ".omp/watch.mjs");
reachCopy("skills/handoff-go/watch.mjs", ".pi/watch.mjs");
const ompMod = await import(pathToFileURL(join(reachRoot, ".omp/extensions/handoff-go-watch.mjs")));
const piMod = await import(pathToFileURL(join(reachRoot, ".pi/extensions/handoff-go-watch.mjs")));
assert.equal(typeof ompMod.default, "function", "OMP universal adapter loads and exports a factory");
assert.equal(typeof piMod.default, "function", "Pi universal adapter loads and exports a factory");

// restore timers
globalThis.setInterval = realSetInterval;
globalThis.clearInterval = realClearInterval;

console.log("watch conformance: PASS");
