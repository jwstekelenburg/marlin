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

/** Built-in UGC allowlist if `data/allowed-apex.txt` is missing. */
export const DEFAULT_ALLOWED_APEXES = [
  "tumblr.com",
  "neocities.org",
  "blogspot.com",
  "nekoweb.org",
  "wordpress.com",
  "github.io",
  "itch.io",
  "bandcamp.com",
  "carrd.co",
  "substack.com",
  "livejournal.com",
  "dreamwidth.org",
  "tistory.com",
  "google.com",
  "wikipedia.org",
];

let fileBlocked: Set<string> | null = null;
/** Postgres `blocked_apexes` overlay — refreshed by fetcher/worker/steward. */
let dbBlocked = new Set<string>();
let fileAllowed: Set<string> | null = null;

function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
}

export function blockedApexFilePath(): string {
  const override = process.env.BLOCKED_APEX_FILE?.trim();
  if (override) return path.resolve(override);
  return path.join(repoRoot(), "data/blocked-apex.txt");
}

export function allowedApexFilePath(): string {
  const override = process.env.ALLOWED_APEX_FILE?.trim();
  if (override) return path.resolve(override);
  return path.join(repoRoot(), "data/allowed-apex.txt");
}

export function parseApexListFile(text: string): Set<string> {
  const out = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim().toLowerCase();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const host = trimmed.replace(/^\./, "");
    if (!host) continue;
    out.add(hostApex(host) || host);
  }
  return out;
}

/** @deprecated alias — prefer parseApexListFile */
export const parseBlockedApexFile = parseApexListFile;

export function loadBlockedApexes(reload = false): Set<string> {
  if (fileBlocked && !reload) return fileBlocked;
  const file = blockedApexFilePath();
  if (!existsSync(file)) {
    fileBlocked = new Set(DEFAULT_BLOCKED_APEXES);
    return fileBlocked;
  }
  fileBlocked = parseApexListFile(readFileSync(file, "utf8"));
  return fileBlocked;
}

export function loadAllowedApexes(reload = false): Set<string> {
  if (fileAllowed && !reload) return fileAllowed;
  const file = allowedApexFilePath();
  if (!existsSync(file)) {
    fileAllowed = new Set(DEFAULT_ALLOWED_APEXES);
    return fileAllowed;
  }
  fileAllowed = parseApexListFile(readFileSync(file, "utf8"));
  return fileAllowed;
}

/** Replace the DB overlay used by isBlockedApexHost (call after querying blocked_apexes). */
export function setBlockedApexDbOverlay(apexes: Iterable<string>): void {
  const next = new Set<string>();
  for (const raw of apexes) {
    const apex = hostApex(raw) || raw.trim().toLowerCase();
    if (apex) next.add(apex);
  }
  dbBlocked = next;
}

export function blockedApexDbOverlaySize(): number {
  return dbBlocked.size;
}

/** File ∪ DB overlay. */
export function allBlockedApexes(reloadFile = false): Set<string> {
  const out = new Set(loadBlockedApexes(reloadFile));
  for (const a of dbBlocked) out.add(a);
  return out;
}

export function isBlockedApexHost(host: string): boolean {
  const apex = hostApex(host);
  if (!apex) return false;
  if (loadBlockedApexes().has(apex)) return true;
  return dbBlocked.has(apex);
}

export function isAllowedApexHost(host: string): boolean {
  const apex = hostApex(host);
  if (!apex) return false;
  return loadAllowedApexes().has(apex);
}
