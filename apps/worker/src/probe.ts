import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  catalogWithoutLlm,
  extractPage,
  fetchHomepage,
  fetchOptionsFromEnv,
  loadCatalogPolicies,
  loadLmProfiles,
  normalizeHost,
  pickSiteName,
  resolveCatalogPolicy,
  skipLmReason,
} from "@marlin/shared";
import { catalogPage, lmClientFrom } from "./lm.js";
import { resolveLmProfile } from "./profile.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
dotenv.config({ path: path.join(repoRoot, ".env") });

function usage(exit = 1): never {
  let lmNames = "(could not load data/lm-profiles.json)";
  let policyNames = "(could not load data/catalog-policies.json)";
  try {
    lmNames = Object.keys(loadLmProfiles()).sort().join(", ");
  } catch {
    // keep fallback
  }
  try {
    policyNames = Object.keys(loadCatalogPolicies()).sort().join(", ");
  } catch {
    // keep fallback
  }
  console.error(`usage: npm run probe -- <domain> --lm <lm-profile> [--policy <catalog-policy>]

options:
  --lm, -l <name>       lm profile from data/lm-profiles.json (required)
  --policy, -P <name>   catalog policy from data/catalog-policies.json
                        (default: CATALOG_POLICY env)

lm profiles: ${lmNames}
catalog policies: ${policyNames}
`);
  process.exit(exit);
}

function parseArgs(argv: string[]): { domain: string; lm: string; policy: string | null } {
  const positionals: string[] = [];
  let lm: string | null = null;
  let policy: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--help" || a === "-h") usage(0);
    if (a === "--lm" || a === "-l") {
      const next = argv[++i];
      if (!next || next.startsWith("-")) usage();
      lm = next;
      continue;
    }
    if (a.startsWith("--lm=")) {
      lm = a.slice("--lm=".length) || null;
      if (!lm) usage();
      continue;
    }
    if (a.startsWith("-l=")) {
      lm = a.slice("-l=".length) || null;
      if (!lm) usage();
      continue;
    }
    if (a === "--policy" || a === "-P") {
      const next = argv[++i];
      if (!next || next.startsWith("-")) usage();
      policy = next;
      continue;
    }
    if (a.startsWith("--policy=")) {
      policy = a.slice("--policy=".length) || null;
      if (!policy) usage();
      continue;
    }
    if (a.startsWith("-P=")) {
      policy = a.slice("-P=".length) || null;
      if (!policy) usage();
      continue;
    }
    if (a.startsWith("-")) {
      console.error(`unknown flag: ${a}`);
      usage();
    }
    positionals.push(a);
  }
  if (positionals.length !== 1 || !lm) usage();
  return { domain: positionals[0]!, lm, policy };
}

const cli = parseArgs(process.argv.slice(2));
let lmProfile;
let catalogPolicy;
try {
  lmProfile = resolveLmProfile({ name: cli.lm });
  catalogPolicy = resolveCatalogPolicy({ name: cli.policy });
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
const lm = lmClientFrom(lmProfile, catalogPolicy);

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
      catalogPolicy: catalogPolicy.name,
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
