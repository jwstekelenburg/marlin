import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getCatalogPolicy,
  getLmProfile,
  getStewardPolicy,
  loadCatalogPolicies,
  loadLmProfiles,
  loadStewardPolicies,
  loadWorkerProfiles,
  lmNameFromArgv,
  policyNameFromArgv,
  profileNameFromArgv,
} from "../src/index.js";

describe("lm + worker profiles + policies", () => {
  it("loads lm profiles with baseUrl", () => {
    const profiles = loadLmProfiles();
    assert.ok(profiles.local);
    assert.match(profiles.local.baseUrl, /^https?:\/\//);
  });

  it("resolves worker profiles through lm keys (no textChars)", () => {
    const workers = loadWorkerProfiles();
    assert.ok(workers.local);
    assert.equal(workers.local.lm, "local");
    assert.equal(workers.local.baseUrl, getLmProfile("local").baseUrl);
    assert.ok(workers.local.concurrency >= 1);
    assert.equal("textChars" in workers.local, false);
  });

  it("loads catalog policy v1-simple", () => {
    const policies = loadCatalogPolicies();
    assert.ok(policies["v1-simple"]);
    const p = getCatalogPolicy("v1-simple");
    assert.ok(p.systemPrompt.length > 100);
    assert.equal(p.textChars, 4000);
    assert.equal(p.sampling.max_tokens, 400);
  });

  it("loads steward policy v1-simple", () => {
    const policies = loadStewardPolicies();
    assert.ok(policies["v1-simple"]);
    const p = getStewardPolicy("v1-simple");
    assert.ok(p.systemPrompt.includes("crawler trap"));
    assert.equal(p.sampleSummaryChars, 400);
    assert.equal(p.sampling.temperature, 0.1);
  });

  it("parses --lm from argv", () => {
    assert.equal(lmNameFromArgv(["node", "probe", "example.com", "--lm", "vast"]), "vast");
    assert.equal(lmNameFromArgv(["node", "probe", "-l=studio-g4-4b", "example.com"]), "studio-g4-4b");
    assert.equal(lmNameFromArgv(["node", "probe", "example.com"]), null);
  });

  it("parses --policy from argv", () => {
    assert.equal(policyNameFromArgv(["node", "worker", "--policy", "v1-simple"]), "v1-simple");
    assert.equal(policyNameFromArgv(["node", "probe", "-P=v1-simple", "x"]), "v1-simple");
    assert.equal(policyNameFromArgv(["node", "worker", "vast"]), null);
  });

  it("parses worker --profile / positional without stealing --policy value", () => {
    assert.equal(profileNameFromArgv(["node", "worker", "vast"]), "vast");
    assert.equal(profileNameFromArgv(["node", "worker", "--profile", "local"]), "local");
    assert.equal(
      profileNameFromArgv(["node", "worker", "--policy", "v1-simple", "vast-g4-4b-1"]),
      "vast-g4-4b-1",
    );
    assert.equal(profileNameFromArgv(["node", "worker", "--policy", "v1-simple"]), null);
  });
});
