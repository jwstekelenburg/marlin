const reset = "\x1b[0m";
const grey = "\x1b[90m";
const blue = "\x1b[94m";
const yellow = "\x1b[33m";
const red = "\x1b[31m";

/** Node's test runner sets NODE_TEST_CONTEXT (e.g. "child-v8"). Also honor NODE_ENV=test. */
function logsSilenced(): boolean {
  return Boolean(process.env.NODE_TEST_CONTEXT) || process.env.NODE_ENV === "test";
}

function format(args: unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === "string") return arg;
      if (arg instanceof Error) return arg.stack ?? arg.message;
      return String(arg);
    })
    .join(" ");
}

function paint(color: string, stream: "log" | "warn" | "error", args: unknown[]): void {
  if (logsSilenced()) return;
  console[stream](`${color}${format(args)}${reset}`);
}

export const log = {
  noisy: (...args: unknown[]) => paint(grey, "log", args),
  info: (...args: unknown[]) => paint(blue, "log", args),
  warn: (...args: unknown[]) => paint(yellow, "warn", args),
  error: (...args: unknown[]) => paint(red, "error", args),
};
