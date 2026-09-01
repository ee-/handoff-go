// Handoff Go Coder watch — Pi coding agent adapter.
//
// Pi loads this as a project-local extension from `.pi/extensions/`. Mirrors the
// OMP semantics so migrating a project between them changes no protocol
// behavior. The `input` event carries `text`/`source` on the event; recognized
// `go watch` commands return `{ action: "handled" }` to consume the original
// text. Pi exposes no managed timer on its ctx, so the raw timer is wrapped,
// cleared on `session_shutdown`, and never becomes process-global state.
import { parseInterval, WATCH_DEFAULT_SECONDS, WATCH_TICK_PROMPT } from "../watch.mjs";

const GO_WATCH_STOP = /^go\s+watch\s+stop$/i;
const GO_WATCH_START = /^go\s+watch(?:\s+(\S+))?$/i;

export default function handoffGoWatch(pi) {
  let state = { active: false, intervalSeconds: WATCH_DEFAULT_SECONDS, timerId: null, pending: false, sessionCtx: null };

  function clearTimer() {
    if (state.timerId != null) {
      clearInterval(state.timerId);
      state.timerId = null;
    }
  }

  function sendTick() {
    if (state.pending) return;
    state.pending = true;
    Promise.resolve(
      pi.sendMessage(
        { content: WATCH_TICK_PROMPT, display: true, attribution: "user" },
        { triggerTurn: true, deliverAs: "followUp" }
      )
    ).finally(() => { state.pending = false; });
  }

  function onTick() {
    if (!state.active) return;
    if (state.sessionCtx?.isIdle && !state.sessionCtx.isIdle()) return; // busy: coalesce
    if (state.pending) return;
    sendTick();
  }

  function start(text, ctx) {
    const m = GO_WATCH_START.exec(text);
    const seconds = m ? parseInterval(m[1]) : null;
    if (m && seconds === null) {
      ctx.ui?.notify?.("Handoff Go watch: interval must be >= 60s (e.g. 60s, 1m, 5m, 1h)", "warn");
      return { action: "handled" };
    }
    state.active = true;
    state.intervalSeconds = seconds ?? WATCH_DEFAULT_SECONDS;
    state.sessionCtx = ctx;
    clearTimer();
    // ponytail: raw timer fallback (Pi ctx has no managed timer); wrapped and
    // cleared on session_shutdown.
    state.timerId = setInterval(() => { try { onTick(); } catch (e) { console.error("go watch tick failed", e); } }, state.intervalSeconds * 1000);
    ctx.ui?.notify?.(`Handoff Go watch: ${state.intervalSeconds / 60}m`, "info");
    sendTick(); // immediate first discovery before the first wait
    return { action: "handled" };
  }

  pi.on("input", async (event, ctx) => {
    if (event.source === "extension") return; // injected wake: continue normally
    const text = String(event.text || "").trim();
    if (GO_WATCH_STOP.test(text)) {
      state.active = false;
      clearTimer();
      ctx.ui?.notify?.("Handoff Go watch stopped", "info");
      return { action: "handled" };
    }
    if (GO_WATCH_START.test(text)) return start(text, ctx);
  });

  pi.on("session_shutdown", (_event, ctx) => { clearTimer(); state.active = false; });
}
