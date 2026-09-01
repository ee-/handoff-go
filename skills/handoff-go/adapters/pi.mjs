// Handoff Go Coder watch — Pi coding agent adapter.
//
// Pi loads this as a project-local extension from `.pi/extensions/`. Mirrors the
// OMP reference semantics so migrating a project between them changes no
// protocol behavior. Raw ordinary-text `go watch` is recognised on the `input`
// event; extension-injected WATCH_TICK_PROMPT wakes are never re-activated.
import { parseInterval, WATCH_DEFAULT_SECONDS, WATCH_TICK_PROMPT } from "../watch.mjs";

const GO_WATCH_STOP = /^go\s+watch\s+stop$/i;
const GO_WATCH_START = /^go\s+watch(?:\s+(\S+))?$/i;

export default function handoffGoWatch(pi) {
  let state = { active: false, intervalSeconds: WATCH_DEFAULT_SECONDS, timerId: null, pending: false };

  function clearTimer(ctx) {
    if (state.timerId != null) {
      if (ctx?.clearTimer) ctx.clearTimer(state.timerId);
      else clearInterval(state.timerId);
      state.timerId = null;
    }
  }

  function ensureTimer(ctx) {
    if (!state.active || state.timerId != null) return;
    const run = () => onTick(ctx);
    if (ctx?.setInterval) {
      state.timerId = ctx.setInterval(run, state.intervalSeconds * 1000);
    } else {
      // ponytail: raw-timer fallback, wrapped + cleared on session_shutdown.
      state.timerId = setInterval(() => { try { run(); } catch (e) { console.error("go watch tick failed", e); } }, state.intervalSeconds * 1000);
    }
  }

  function onTick(ctx) {
    if (!state.active) return;
    if (ctx?.isIdle && !ctx.isIdle()) return; // busy: coalesce/skip, no overlap
    if (state.pending) return;               // at most one pending wake
    state.pending = true;
    Promise.resolve(
      pi.sendMessage(
        { content: WATCH_TICK_PROMPT, display: true, attribution: "user" },
        { triggerTurn: true, deliverAs: "followUp" }
      )
    ).finally(() => { state.pending = false; });
  }

  function stop(ctx) {
    state.active = false;
    clearTimer(ctx);
  }

  function start(text, ctx) {
    const m = GO_WATCH_START.exec(text);
    const seconds = m ? parseInterval(m[1]) : null;
    if (m && seconds === null) {
      ctx?.ui?.notify?.("Handoff Go watch: interval must be >= 60s (e.g. 60s, 1m, 5m, 1h)", "warn");
      return;
    }
    state.active = true;
    state.intervalSeconds = seconds ?? WATCH_DEFAULT_SECONDS;
    clearTimer(ctx);
    ensureTimer(ctx);
    ctx?.ui?.notify?.(`Handoff Go watch: ${state.intervalSeconds / 60}m`, "info");
    // Immediate first discovery before the first wait.
    state.pending = true;
    Promise.resolve(
      pi.sendMessage(
        { content: WATCH_TICK_PROMPT, display: true, attribution: "user" },
        { triggerTurn: true, deliverAs: "followUp" }
      )
    ).finally(() => { state.pending = false; });
  }

  pi.on("input", async (_event, ctx) => {
    if (ctx.source === "extension") return; // never re-activate on injected wake
    const text = String(ctx.text || "").trim();
    if (GO_WATCH_STOP.test(text)) { stop(ctx); ctx.ui?.notify?.("Handoff Go watch stopped", "info"); return; }
    if (GO_WATCH_START.test(text)) start(text, ctx);
  });

  pi.on("session_start", (_e, ctx) => {
    if (state.active) ensureTimer(ctx);
  });

  pi.on("session_shutdown", (_event, ctx) => { stop(ctx); });
}
