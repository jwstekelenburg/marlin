import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  catalogWithoutLlm,
  envInt,
  extractPage,
  fetchHomepage,
  fetchOptionsFromEnv,
  normalizeHost,
  pickSiteName,
  skipLmReason,
} from "@marlin/shared";
import { catalogPage, lmClientFromProfile } from "./lm.js";
import { resolveLmProfile } from "./profile.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
dotenv.config({ path: path.join(repoRoot, ".env") });

function usage(exit = 1): never {
  console.error(`usage: npm run probe -- <domain> --lm <lm-profile>

options:
  --lm, -l <name>   lm profile from data/lm-profiles.json (required)
`);
  process.exit(exit);
}

function parseArgs(argv: string[]): { domain: string } {
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--help" || a === "-h") usage(0);
    if (a === "--lm" || a === "-l") {
      if (!argv[i + 1] || argv[i + 1]!.startsWith("-")) usage();
      i += 1;
      continue;
    }
    if (a.startsWith("--lm=") || a.startsWith("-l=")) continue;
    if (a.startsWith("-")) {
      console.error(`unknown flag: ${a}`);
      usage();
    }
    positionals.push(a);
  }
  if (positionals.length !== 1) usage();
  return { domain: positionals[0]! };
}

const cli = parseArgs(process.argv.slice(2));
const lmProfile = resolveLmProfile({ argv: process.argv });
const textChars = envInt("LM_TEXT_CHARS", 4000);
const lm = lmClientFromProfile(lmProfile, textChars);

const host = normalizeHost(cli.domain);
if (!host) {
  console.error(JSON.stringify({ error: "invalid domain", input: cli.domain }, null, 2));
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
      lm,
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
      lmProfile: lmProfile.name,
      model: lm.model || null,
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
