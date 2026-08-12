import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  hasNonEnglishLanguageSubdomain,
  hostTld,
  isAllowedEnglishTld,
  isIndexableHost,
  isNonEnglishLangLabel,
} from "../src/index.js";

afterEach(() => {
  delete process.env.TLD_WHITELIST;
});

describe("hostTld / English TLD whitelist", () => {
  it("uses the last label only (.co.uk → uk)", () => {
    assert.equal(hostTld("example.co.uk"), "uk");
    assert.equal(hostTld("de.wikipedia.org"), "org");
    assert.ok(isAllowedEnglishTld("example.co.uk"));
    assert.ok(isAllowedEnglishTld("de.wikipedia.org"));
  });

  it("rejects non-whitelisted ccTLDs", () => {
    assert.equal(isAllowedEnglishTld("example.de"), false);
    assert.equal(isAllowedEnglishTld("example.jp"), false);
  });

  it("honors TLD_WHITELIST override", () => {
    process.env.TLD_WHITELIST = "de, jp";
    assert.ok(isAllowedEnglishTld("example.de"));
    assert.ok(isAllowedEnglishTld("foo.jp"));
    assert.equal(isAllowedEnglishTld("example.com"), false);
  });
});

describe("language-subdomain filter", () => {
  it("treats ISO language labels as non-English editions", () => {
    assert.equal(isNonEnglishLangLabel("de"), true);
    assert.equal(isNonEnglishLangLabel("fr"), true);
    assert.equal(isNonEnglishLangLabel("arz"), true);
    assert.equal(isNonEnglishLangLabel("simple"), true);
  });

  it("allows en / en-us and non-language labels", () => {
    assert.equal(isNonEnglishLangLabel("en"), false);
    assert.equal(isNonEnglishLangLabel("en-us"), false);
    assert.equal(isNonEnglishLangLabel("en_GB"), false);
    assert.equal(isNonEnglishLangLabel("us"), false);
    assert.equal(isNonEnglishLangLabel("www"), false);
    assert.equal(isNonEnglishLangLabel("blog"), false);
  });

  it("detects language labels before the registrable root", () => {
    assert.equal(hasNonEnglishLanguageSubdomain("fr.wikipedia.org"), true);
    assert.equal(hasNonEnglishLanguageSubdomain("de.wikipedia.org"), true);
    assert.equal(hasNonEnglishLanguageSubdomain("tr.mitsubishielectric.com"), true);
    assert.equal(hasNonEnglishLanguageSubdomain("arz.wikipedia.org"), true);
  });

  it("keeps English editions, apexes, and non-language subdomains", () => {
    assert.equal(hasNonEnglishLanguageSubdomain("en.wikipedia.org"), false);
    assert.equal(hasNonEnglishLanguageSubdomain("en-us.example.com"), false);
    assert.equal(hasNonEnglishLanguageSubdomain("wikipedia.org"), false);
    assert.equal(hasNonEnglishLanguageSubdomain("us.example.com"), false);
    assert.equal(hasNonEnglishLanguageSubdomain("blog.example.com"), false);
    assert.equal(hasNonEnglishLanguageSubdomain("example.co.uk"), false);
  });

  it("does not treat private-suffix UGC accounts as language editions", () => {
    // allowPrivateDomains: true — de.github.io is the registrable name, not de + github.io
    assert.equal(hasNonEnglishLanguageSubdomain("de.github.io"), false);
  });
});

describe("isIndexableHost", () => {
  it("requires English TLD and no non-English language subdomain", () => {
    assert.equal(isIndexableHost("example.com"), true);
    assert.equal(isIndexableHost("en-us.example.com"), true);
    assert.equal(isIndexableHost("us.example.com"), true);
    // TLD ok (.org) but language subdomain blocks
    assert.equal(isIndexableHost("de.wikipedia.org"), false);
    assert.equal(isIndexableHost("example.de"), false);
  });
});
