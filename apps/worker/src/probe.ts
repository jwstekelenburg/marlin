import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractPage,
  fetchHomepage,
  fetchOptionsFromEnv,
  isNearEmptyBody,
  normalizeHost,
  parkedFromEmptyPage,
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
const emptyBody = isNearEmptyBody(page.body);

let result: {
  name: string;
  summary: string;
  category: string;
  tags: string[];
};
let llmName = "";

if (emptyBody) {
  result = parkedFromEmptyPage(host, page.title);
} else {
  const catalog = await catalogPage({
    url: fetched.finalUrl,
    title: page.title,
    text: page.text,
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
      emptyBody,
      skippedLm: emptyBody,
      llmInput: emptyBody
        ? null
        : { url: fetched.finalUrl, title: page.title, body: page.text },
      result,
      llmName,
    },
    null,
    2,
  ),
);
