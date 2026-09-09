// Handoff Go Coder watch — Universal extension adapter for OMP and Pi.
//
// Native discovery:
//   Harness loaders (OMP and Pi) scan for direct `*.js` or `*.ts` files in
//   `.omp/extensions/` and `.pi/extensions/`. This file is named `.js` to be
//   natively auto-discovered upon harness startup.
//
// Auto-detects managed vs raw timer environments:
//   - Managed host (OMP): uses `ctx.setInterval` and `ctx.clearTimer`.
//   - Fallback host (Pi): uses raw `setInterval` and `clearInterval`.
//
// Wake gate (durable-state fingerprint):
//   Cheaply probes GitHub durable state before waking the model. When state is
//   unchanged, the watcher stays dormant (zero tokens, zero UI churn).
//   On any probe failure, API error, or pagination truncation, it fails open
//   and executes a normal Coder `go`.
//
// Terminal-settlement rule:
//   `pi.sendMessage(...)` returns void; it is NOT a turn-completion promise.
//   The observation baseline converges only inside a terminal `agent_end`
//   lifecycle event (`willContinue !== true`) for the watch-triggered turn, so a
//   durable change written during that turn can never be swallowed before one
//   full Coder rediscovery. A non-terminal `agent_end` (auto-retry / scheduled
//   continuation) and a terminal `agent_end` while the queued wake has not
//   started are ignored. A tick may settle only as a bounded fallback when the
//   host never emitted a terminal event: session idle and nothing queued.
//
// Busy / coalescing rule:
//   While the watch turn is in flight, or the host is busy, at most one
//   `pendingWake` is remembered. Ticks never overlap turns and never queue one
//   wake per missed interval. A busy tick with unchanged durable state only
//   publishes `WATCH_BUSY`; it never wakes the model.
import { execFileSync } from "node:child_process";
import {
  parseWatchCommand,
  WATCH_ACTIVE,
  WATCH_BUSY,
  WATCH_DEFAULT_SECONDS,
  WATCH_NOT_ACTIVE,
  WATCH_PENDING_WAKE,
  WATCH_SETTLING,
  WATCH_SLEEPING,
  WATCH_STATUS_KEY,
  WATCH_TICK_PROMPT,
  WATCH_WAKE,
} from "../watch.mjs";

export function getDurableStateFingerprint(cwd) {
  try {
    const out = execFileSync(
      "gh",
      [
        "api",
        "graphql",
        "-F",
        "owner=:owner",
        "-F",
        "repo=:repo",
        "-f",
        "query=query($owner: String!, $repo: String!) { repository(owner: $owner, name: $repo) { defaultBranchRef { target { oid } } issues(first: 50, states: OPEN) { pageInfo { hasNextPage } nodes { number updatedAt } } pullRequests(first: 50, states: OPEN) { pageInfo { hasNextPage } nodes { number updatedAt headRefOid } } } }",
      ],
      {
        encoding: "utf8",
        timeout: 10000,
        cwd: cwd || process.cwd(),
        stdio: ["ignore", "pipe", "ignore"],
      }
    );
    const d = JSON.parse(out);
    const repo = d?.data?.repository;
    if (!repo) return null;
    // Fail open on pagination boundary / truncation condition
    if (repo.issues?.pageInfo?.hasNextPage || repo.pullRequests?.pageInfo?.hasNextPage) {
      return null;
    }
    const headOid = repo.defaultBranchRef?.target?.oid || "";
    const issues = (repo.issues?.nodes || [])
      .map((i) => `${i.number}:${i.updatedAt}`)
      .sort()
      .join(",");
    const prs = (repo.pullRequests?.nodes || [])
      .map((p) => `${p.number}:${p.updatedAt}:${p.headRefOid}`)
      .sort()
      .join(",");
    return `${headOid}|${issues}|${prs}`;
  } catch {
    // Fail open on probe ambiguity, missing gh, auth problem, or API error
    return null;
  }
}

export default function handoffGoWatch(pi, options = {}) {
  const probe = options?.probe || getDurableStateFingerprint;
  let active = false;
  let intervalSeconds = WATCH_DEFAULT_SECONDS;
  let timerId = null;
  let sessionCtx = null;
  let baselineFingerprint = null;
  let wakeFingerprint = null;
  let wakeInFlight = false; // exactly one watch-triggered Coder turn is running
  let pendingWake = false; // at most one coalesced wake / convergence check
  let lastStatus; // dedupe native status updates (no UI spam)

  function clearTimer() {
    if (timerId != null) {
      if (sessionCtx?.clearTimer) sessionCtx.clearTimer(timerId);
      else clearInterval(timerId);
      timerId = null;
    }
  }

  // Native runtime status: host UI surface only, never a model turn. Feature-
  // detected so unsupported/unverified hosts degrade to no-ops.
  function setStatus(status, ctx) {
    if (status === lastStatus) return;
    lastStatus = status;
    try {
      (ctx || sessionCtx)?.ui?.setStatus?.(WATCH_STATUS_KEY, status);
    } catch {
      // Best-effort observability only.
    }
  }

  function clearStatus(ctx) {
    lastStatus = undefined;
    try {
      (ctx || sessionCtx)?.ui?.setStatus?.(WATCH_STATUS_KEY, undefined);
    } catch {
      // Best-effort observability only.
    }
  }

  function idle(ctx) {
    const c = ctx || sessionCtx;
    return !c?.isIdle || c.isIdle();
  }

  function queued(ctx) {
    const c = ctx || sessionCtx;
    return !!(c?.hasPendingMessages && c.hasPendingMessages());
  }

  function sendWake(fp, ctx) {
    wakeInFlight = true;
    wakeFingerprint = fp;
    try {
      pi.sendMessage(
        { content: WATCH_TICK_PROMPT, display: true, attribution: "user" },
        { triggerTurn: true, deliverAs: "followUp" }
      );
      setStatus(WATCH_WAKE, ctx);
    } catch {
      // No turn exists, so never hold a phantom in-flight wake. The baseline
      // stays unconverged and the next tick retries the wake.
      wakeInFlight = false;
      wakeFingerprint = null;
    }
  }

  // The only place the observation watermark may converge. Driven by the
  // terminal `agent_end` lifecycle event, or by the bounded tick fallback above.
  function settle(ctx) {
    if (!wakeInFlight) return;
    wakeInFlight = false;
    const settledFp = probe((ctx || sessionCtx)?.cwd);
    if (wakeFingerprint != null && settledFp != null && wakeFingerprint === settledFp) {
      // The watch turn observed stable durable state: converge and go dormant.
      baselineFingerprint = settledFp;
      pendingWake = false;
      setStatus(WATCH_SLEEPING, ctx);
      return;
    }
    // Durable state moved during the turn, or the probe is unknown: keep the
    // baseline unconverged and require exactly one full settling rediscovery.
    pendingWake = true;
    setStatus(WATCH_SETTLING, ctx);
  }

  function onTick() {
    if (!active) return;
    const ctx = sessionCtx;

    if (wakeInFlight) {
      // Never overlap a live turn. A tick may settle only when the session is
      // provably idle with nothing queued — the bounded fallback for a host
      // that never emitted a terminal `agent_end`.
      if (!idle(ctx) || queued(ctx)) return;
      settle(ctx);
      return;
    }

    const currentFp = probe(ctx?.cwd);
    const needsWake =
      pendingWake ||
      currentFp == null ||
      baselineFingerprint == null ||
      currentFp !== baselineFingerprint;
    if (!idle(ctx)) {
      // Never wake or overlap while the host is busy: remember at most one
      // pending wake (drained by a later idle tick) or publish truthful busy.
      if (needsWake) {
        pendingWake = true;
        setStatus(WATCH_PENDING_WAKE, ctx);
      } else {
        setStatus(WATCH_BUSY, ctx);
      }
      return;
    }
    if (!needsWake) {
      pendingWake = false;
      setStatus(WATCH_SLEEPING, ctx);
      return;
    }
    pendingWake = false;
    sendWake(currentFp, ctx);
  }

  function start(seconds, ctx) {
    active = true;
    intervalSeconds = seconds;
    sessionCtx = ctx;
    baselineFingerprint = null;
    wakeFingerprint = null;
    wakeInFlight = false;
    pendingWake = false;
    lastStatus = undefined;
    clearTimer();

    if (ctx?.setInterval) {
      timerId = ctx.setInterval(onTick, intervalSeconds * 1000);
    } else {
      timerId = setInterval(() => {
        try { onTick(); } catch (e) { console.error("go watch tick failed", e); }
      }, intervalSeconds * 1000);
    }

    ctx.ui?.notify?.(`Handoff Go watch: ${intervalSeconds / 60}m`, "info");
    setStatus(WATCH_ACTIVE, ctx);

    // Immediate first discovery before the first wait
    sendWake(probe(ctx?.cwd), ctx);

    return { handled: true, action: "handled" };
  }

  pi.on("agent_end", (event, ctx) => {
    if (!active || !wakeInFlight) return;
    // A scheduled auto-retry / continuation is not a terminal settle.
    if (event?.willContinue === true) return;
    // The queued wake has not started yet: the drain owns that turn.
    if (queued(ctx) || !idle(ctx)) return;
    settle(ctx);
  });

  pi.on("input", async (event, ctx) => {
    if (event.source === "extension") return; // injected wake: continue normally

    const cmd = parseWatchCommand(event.text);
    if (cmd.kind === "stop") {
      const wasActive = active;
      active = false;
      clearTimer();
      baselineFingerprint = null;
      wakeFingerprint = null;
      wakeInFlight = false;
      pendingWake = false;
      clearStatus(ctx);
      // AC-5: never invent an active watcher to stop. A stop before any start
      // in this session reports the canonical not-active outcome instead.
      ctx.ui?.notify?.(wasActive ? "Handoff Go watch stopped" : WATCH_NOT_ACTIVE, "info");
      return { handled: true, action: "handled" };
    }
    if (cmd.invalid) {
      ctx.ui?.notify?.("Handoff Go watch: interval must be >= 60s (e.g. 60s, 1m, 5m, 1h)", "warn");
      return { handled: true, action: "handled" };
    }
    if (cmd.kind === "start") {
      return start(cmd.intervalSeconds, ctx);
    }
  });

  pi.on("session_shutdown", (_event, ctx) => {
    clearTimer();
    active = false;
    baselineFingerprint = null;
    wakeFingerprint = null;
    wakeInFlight = false;
    pendingWake = false;
    clearStatus(ctx);
  });
}
