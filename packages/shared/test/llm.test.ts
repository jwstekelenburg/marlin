import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isWeakSummary, normalizeLabel, parseCatalogResult } from "../src/llm.js";

describe("normalizeLabel", () => {
  it("trims, lowercases, and collapses whitespace", () => {
    assert.equal(normalizeLabel("  Social  Media "), "social media");
  });
});

describe("isWeakSummary", () => {
  it("flags short stubs and category/tag echoes", () => {
    assert.equal(isWeakSummary("blog"), true);
    assert.equal(isWeakSummary("personal-site", "personal", ["personal-site"]), true);
    assert.equal(isWeakSummary("ecommerce", "ecommerce", []), true);
    assert.equal(isWeakSummary("personal-portfolio-site"), true);
  });

  it("accepts real prose", () => {
    assert.equal(
      isWeakSummary(
        "A personal portfolio for a product designer based in London, showing case studies and contact details.",
        "portfolio",
        ["design", "personal"],
      ),
      false,
    );
  });
});

describe("parseCatalogResult", () => {
  const good = {
    name: "Acme",
    summary:
      "Acme sells widgets to small businesses. The homepage lists products, pricing, and a contact form.",
    category: "Ecommerce",
    tags: ["widgets", "Widgets", "b2b", "extra1", "extra2", "extra3"],
    language: "en",
    place: "Austin",
    country: "US",
  };

  it("normalizes category/tags and caps tags at 5 unique", () => {
    const result = parseCatalogResult(good);
    assert.equal(result.category, "ecommerce");
    assert.deepEqual(result.tags, ["widgets", "b2b", "extra1", "extra2", "extra3"]);
    assert.equal(result.language, "en");
    assert.equal(result.country, "US");
    assert.equal(result.place, "Austin");
  });

  it("coerces empty geo fields to null", () => {
    const result = parseCatalogResult({
      ...good,
      language: "",
      place: "",
      country: "",
    });
    assert.equal(result.language, null);
    assert.equal(result.place, null);
    assert.equal(result.country, null);
  });

  it("rejects non-objects and missing summary/category", () => {
    assert.throws(() => parseCatalogResult(null), /not an object/);
    assert.throws(() => parseCatalogResult("nope"), /not an object/);
    assert.throws(
      () => parseCatalogResult({ ...good, summary: "" }),
      /missing summary/,
    );
    assert.throws(
      () => parseCatalogResult({ ...good, category: "  " }),
      /missing category/,
    );
  });

  it("tolerates missing name and non-array tags", () => {
    const result = parseCatalogResult({
      ...good,
      name: 123,
      tags: "nope",
    });
    assert.equal(result.name, "");
    assert.deepEqual(result.tags, []);
  });
});
