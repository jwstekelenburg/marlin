import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cleanPageTitle, pickSiteName } from "../src/name.js";

describe("cleanPageTitle", () => {
  it("strips trailing Home / Official Site suffixes", () => {
    assert.equal(cleanPageTitle("Acme Corp - Home", "acme.com"), "Acme Corp");
    assert.equal(cleanPageTitle("Acme | Official Website", "acme.com"), "Acme");
  });

  it("prefers a branded multi-word segment over the hostname", () => {
    assert.equal(
      cleanPageTitle("Shippensburg University | ship.edu", "ship.edu"),
      "Shippensburg University",
    );
  });
});

describe("pickSiteName", () => {
  it("falls back to cleaned title then host when LLM name is empty", () => {
    assert.equal(
      pickSiteName({ llmName: "", title: "Acme Labs - Home", host: "acme.com", category: "saas" }),
      "Acme Labs",
    );
    assert.equal(
      pickSiteName({ llmName: "", title: "", host: "acme.com", category: "saas" }),
      "acme.com",
    );
  });

  it("rejects generic LLM names when a title exists", () => {
    assert.equal(
      pickSiteName({
        llmName: "University",
        title: "Shippensburg University",
        host: "ship.edu",
        category: "education",
      }),
      "Shippensburg University",
    );
  });

  it("rejects LLM name that is just the category", () => {
    assert.equal(
      pickSiteName({
        llmName: "blog",
        title: "Jane's Notes",
        host: "jane.example.com",
        category: "blog",
      }),
      "Jane's Notes",
    );
  });

  it("prefers a multi-word title over a short single-word LLM name", () => {
    assert.equal(
      pickSiteName({
        llmName: "Portal",
        title: "City Library Portal",
        host: "library.example.com",
        category: "education",
      }),
      "City Library Portal",
    );
  });

  it("keeps a real LLM proper name", () => {
    assert.equal(
      pickSiteName({
        llmName: "Shippensburg University",
        title: "Home",
        host: "ship.edu",
        category: "education",
      }),
      "Shippensburg University",
    );
  });
});
