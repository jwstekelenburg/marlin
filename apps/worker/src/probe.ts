import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractPage,
  fetchHomepage,
  fetchOptionsFromEnv,
  normalizeHost,
  pickSiteName,
} from "@marlin/shared";
import { catalogPage } from "./lm.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
dotenv.config({ path: path.join(repoRoot, ".env") });

const input = process.argv[2];
if (!input) {
  console.error("usage: npm run probe -- <domain>");
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
const text = page.text || page.description || page.title || host;

const result = await catalogPage({
  url: fetched.finalUrl,
  title: page.title,
  text,
});

const name = pickSiteName({
  llmName: result.name,
  title: page.title,
  host,
  category: result.category,
});

console.log(
  JSON.stringify(
    {
      host,
      url: fetched.finalUrl,
      httpStatus: fetched.status,
      title: page.title,
      textChars: text.length,
      result: { ...result, name },
      llmName: result.name,
    },
    null,
    2,
  ),
);
