import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  catalogWithoutLlm,
  extractPage,
  fetchHomepage,
  fetchOptionsFromEnv,
  normalizeHost,
  pickSiteName,
  skipLmReason,
} from "@marlin/shared";
import { catalogPage } from "./lm.js";
import { resolveWorkerProfile } from "./profile.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
dotenv.config({ path: path.join(repoRoot, ".env") });

const profile = resolveWorkerProfile();

const input = process.argv[2];
if (!input) {
  console.error("usage: npm run probe -- <domain>  (uses WORKER_PROFILE)");
  process.exit(1);
}

const host = normalizeHost(input);
if (!host) {
  console.error(JSON.stringify({ error: "invalid domain", input }, null, 2));
  process.exit(1);
}

const fetched = await fetchHomepage(host, fetchOptionsFromEnv());
if ("error" in fetched) {
  console.error(
    JSON.stringify({ error: "fetch failed", host, detail: fetched.error }, null, 2),
  );
  process.exit(1);
}

const page = extractPage(fetched.html, fetched.finalUrl);
const skipLm = skipLmReason(page.title, page.body);

let result: {
  name: string;
  summary: string;
  category: string;
  tags: string[];
  language: string | null;
  place: string | null;
  country: string | null;
} | null = null;
let llmName = "";
let lmError: string | null = null;

if (skipLm) {
  result = catalogWithoutLlm(skipLm, host, page.title);
} else {
  try {
    const catalog = await catalogPage({
      url: fetched.finalUrl,
      title: page.title,
      text: page.text,
      lm: profile,
    });
    llmName = catalog.name;
    result = {
      ...catalog,
      name: pickSiteName({
        llmName: catalog.name,
        title: page.title,
        host,
        category: catalog.category,
      }),
    };
  } catch (err) {
    lmError = err instanceof Error ? err.message : String(err);
  }
}

console.log(
  JSON.stringify(
    {
      host,
      url: fetched.finalUrl,
      httpStatus: fetched.status,
      title: page.title,
      description: page.description,
      htmlChars: fetched.html.length,
      htmlHead: fetched.html.slice(0, 400),
      bodyChars: page.body.length,
      body: page.body,
      skipLm,
      skippedLm: Boolean(skipLm),
      language: result?.language ?? null,
      place: result?.place ?? null,
      country: result?.country ?? null,
      llmInput: skipLm
        ? null
        : { url: fetched.finalUrl, title: page.title, body: page.text },
      result,
      llmName,
      lmError,
    },
    null,
    2,
  ),
);

if (lmError) process.exit(1);
