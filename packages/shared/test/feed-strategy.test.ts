import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  loadFeedPrompt,
  loadFeedStrategy,
  parseFeedStrategy,
} from "../src/feed-strategy.js";

describe("feed strategy", () => {
  it("normalizes names, drops junk, keeps notes", () => {
    const s = parseFeedStrategy(`{
      "includeCategories": [" Portfolio ", "portfolio", "", 1],
      "includeTagsAny": ["Zine"],
      "excludeCategories": ["corporate"],
      "requireTagIfCategory": ["blog", "personal"],
      "notes": " makers "
    }`);
    assert.deepEqual(s.includeCategories, ["portfolio"]);
    assert.deepEqual(s.includeTagsAny, ["zine"]);
    assert.deepEqual(s.excludeCategories, ["corporate"]);
    assert.deepEqual(s.excludeTags, []);
    assert.deepEqual(s.requireTagIfCategory, ["blog", "personal"]);
    assert.deepEqual(s.liftIgnored, []);
    assert.equal(s.notes, "makers");
  });

  it("rejects non-objects", () => {
    assert.throws(() => parseFeedStrategy("[]"), /JSON object/);
  });

  it("loads the committed makers strategy and prompt", () => {
    const prompt = loadFeedPrompt(true);
    assert.match(prompt, /makers/i);
    const s = loadFeedStrategy(true);
    assert.ok(s.includeCategories.includes("portfolio"));
    assert.ok(s.requireTagIfCategory.includes("blog"));
    assert.ok(s.requireTagIfCategory.includes("other"));
    assert.ok(s.excludeCategories.includes("corporate"));
    assert.equal(s.includeCategories.includes("blog"), false);
    assert.equal(s.includeCategories.includes("other"), false);
  });
});
