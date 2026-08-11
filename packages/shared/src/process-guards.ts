import { log } from "./log.js";

/**
 * undici can throw AssertionError from a TLS socket `end` handler when the
 * HTTP/1 parser is paused (unread body) and the peer closes — uncatchable via
 * try/catch around `fetch`. Swallow that so crawlers keep running.
 * See https://github.com/nodejs/undici/issues/5360
 */
function isUndiciSocketEndAssert(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; name?: string; stack?: string; message?: string };
  if (e.code !== "ERR_ASSERTION" && e.name !== "AssertionError") return false;
  const stack = e.stack ?? "";
  return (
    stack.includes("client-h1") ||
    stack.includes("Parser.finish") ||
    stack.includes("onHttpSocketEnd")
  );
}

/** Install once per process. Safe to call multiple times. */
export function installFetchCrashGuards(label = "process"): void {
  const g = globalThis as typeof globalThis & { __marlinFetchGuards?: boolean };
  if (g.__marlinFetchGuards) return;
  g.__marlinFetchGuards = true;

  process.on("uncaughtException", (err) => {
    if (isUndiciSocketEndAssert(err)) {
      log.warn(`${label}: swallowed undici socket-end assert (keep running):`, err);
      return;
    }
    log.error(`${label}: uncaughtException:`, err);
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    if (isUndiciSocketEndAssert(reason)) {
      log.warn(`${label}: swallowed undici socket-end rejection (keep running):`, reason);
      return;
    }
    log.error(`${label}: unhandledRejection:`, reason);
  });
}
