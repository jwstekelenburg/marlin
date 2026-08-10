import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hostApex } from "./apex.js";

/** Built-in crawler-trap apexes if `data/blocked-apex.txt` is missing. */
export const DEFAULT_BLOCKED_APEXES = [
  "839671.com",
  "ajfpt.com",
  "iftopic.com",
  "forumotion.com",
  "forumotion.co.uk",
  "forumotion.net",
  "forumotion.me",
  "forumactif.com",
  "forumactif.org",
  "forumactif.us",
  "forumactif.biz",
  "forumactif.pro",
  "forumactif.info",
  "forumactif.name",
  "forumgratuit.org",
  "1fr1.net",
  "goodforum.net",
  "canadian-forum.com",
  "freeforums-hosting.com",
];

let cached: Set<string> | null = null;

function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
}

export function blockedApexFilePath(): string {
  const override = process.env.BLOCKED_APEX_FILE?.trim();
  if (override) return path.resolve(override);
  return path.join(repoRoot(), "data/blocked-apex.txt");
}

export function parseBlockedApexFile(text: string): Set<string> {
  const out = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim().toLowerCase();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const host = trimmed.replace(/^\./, "");
    if (host) out.add(hostApex(host) || host);
  }
  return out;
}

export function loadBlockedApexes(reload = false): Set<string> {
  if (cached && !reload) return cached;
  const file = blockedApexFilePath();
  if (!existsSync(file)) {
    cached = new Set(DEFAULT_BLOCKED_APEXES);
    return cached;
  }
  cached = parseBlockedApexFile(readFileSync(file, "utf8"));
  return cached;
}

export function isBlockedApexHost(host: string): boolean {
  return loadBlockedApexes().has(hostApex(host));
}
