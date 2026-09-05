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
// Observation-watermark rule:
//   Baseline fingerprint only converges when state before and after an active
//   turn matches (`wakeFp === settledFp`). If state changes during a turn,
//   the baseline does not advance, ensuring a follow-up settling tick runs.
import { execFileSync } from "node:child_process";
import { parseWatchCommand, WATCH_DEFAULT_SECONDS, WATCH_TICK_PROMPT } from "../watch.mjs";

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
  let pending = false;
  let sessionCtx = null;
  let baselineFingerprint = null;
  let wakeFingerprint = null;

  function clearTimer() {
    if (timerId != null) {
      if (sessionCtx?.clearTimer) sessionCtx.clearTimer(timerId);
      else clearInterval(timerId);
      timerId = null;
    }
  }

  function sendTick(wakeFp) {
    if (pending) return;
    pending = true;
    wakeFingerprint = wakeFp;

    Promise.resolve(
      pi.sendMessage(
        { content: WATCH_TICK_PROMPT, display: true, attribution: "user" },
        { triggerTurn: true, deliverAs: "followUp" }
      )
    ).finally(() => {
      pending = false;
      // Observation-watermark rule:
      // Probe again after the turn settles.
      const settledFp = probe(sessionCtx?.cwd);
      if (wakeFingerprint != null && settledFp != null && wakeFingerprint === settledFp) {
        // State did not change during the turn -> safe to converge baseline
        baselineFingerprint = settledFp;
      }
      // If wakeFingerprint !== settledFp, keep baseline unconverged so next tick runs
    });
  }

  function onTick() {
    if (!active) return;
    if (sessionCtx?.isIdle && !sessionCtx.isIdle()) return; // busy: coalesce, no overlap
    if (pending) return;                                   // at most one pending wake

    const currentFp = probe(sessionCtx?.cwd);

    // Fail-open rule: wake if probe is unknown/error (null), baseline unconverged (null),
    // or durable state has changed since baseline.
    if (currentFp == null || baselineFingerprint == null || currentFp !== baselineFingerprint) {
      sendTick(currentFp);
    }
  }

  function start(seconds, ctx) {
    active = true;
    intervalSeconds = seconds;
    sessionCtx = ctx;
    baselineFingerprint = null;
    wakeFingerprint = null;
    clearTimer();

    if (ctx?.setInterval) {
      timerId = ctx.setInterval(onTick, intervalSeconds * 1000);
    } else {
      timerId = setInterval(() => {
        try { onTick(); } catch (e) { console.error("go watch tick failed", e); }
      }, intervalSeconds * 1000);
    }

    ctx.ui?.notify?.(`Handoff Go watch: ${intervalSeconds / 60}m`, "info");

    // Immediate first discovery before the first wait
    const firstFp = probe(ctx?.cwd);
    sendTick(firstFp);

    return { handled: true, action: "handled" };
  }

  pi.on("input", async (event, ctx) => {
    if (event.source === "extension") return; // injected wake: continue normally

    const cmd = parseWatchCommand(event.text);
    if (cmd.kind === "stop") {
      active = false;
      clearTimer();
      baselineFingerprint = null;
      wakeFingerprint = null;
      ctx.ui?.notify?.("Handoff Go watch stopped", "info");
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

  pi.on("session_shutdown", () => {
    clearTimer();
    active = false;
    baselineFingerprint = null;
    wakeFingerprint = null;
  });
}
