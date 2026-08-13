import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getLmProfile,
  loadLmProfiles,
  loadWorkerProfiles,
  lmNameFromArgv,
  profileNameFromArgv,
} from "../src/index.js";

describe("lm + worker profiles", () => {
  it("loads lm profiles with baseUrl", () => {
    const profiles = loadLmProfiles();
    assert.ok(profiles.local);
    assert.match(profiles.local.baseUrl, /^https?:\/\//);
  });

  it("resolves worker profiles through lm keys", () => {
    const workers = loadWorkerProfiles();
    assert.ok(workers.local);
    assert.equal(workers.local.lm, "local");
    assert.equal(workers.local.baseUrl, getLmProfile("local").baseUrl);
    assert.ok(workers.local.concurrency >= 1);
    assert.ok(workers.local.textChars >= 256);
  });

  it("parses --lm from argv", () => {
    assert.equal(lmNameFromArgv(["node", "probe", "example.com", "--lm", "vast"]), "vast");
    assert.equal(lmNameFromArgv(["node", "probe", "-l=studio-g4-4b", "example.com"]), "studio-g4-4b");
    assert.equal(lmNameFromArgv(["node", "probe", "example.com"]), null);
  });

  it("parses worker --profile / positional", () => {
    assert.equal(profileNameFromArgv(["node", "worker", "vast"]), "vast");
    assert.equal(profileNameFromArgv(["node", "worker", "--profile", "local"]), "local");
  });
});
