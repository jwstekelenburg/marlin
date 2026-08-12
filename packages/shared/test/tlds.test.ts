import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  crawlPriorityAdjustForLanguage,
  hasNonEnglishLanguageSubdomain,
  hostTld,
  isAllowedEnglishTld,
  isIndexableHost,
  isNonEnglishLangLabel,
  loadAllowedTlds,
  loadLanguagePriorityConfig,
  parseLanguagePriorityFile,
  parseTldFile,
} from "../src/index.js";

afterEach(() => {
  delete process.env.TLD_WHITELIST;
  delete process.env.TLD_FILE;
  delete process.env.LANGUAGE_PRIORITY_FILE;
  loadAllowedTlds(true);
  loadLanguagePriorityConfig(true);
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

  it("loads data/tlds.txt by default", () => {
    const tlds = loadAllowedTlds(true);
    assert.ok(tlds.has("com"));
    assert.ok(tlds.has("uk"));
    assert.equal(tlds.has("de"), false);
  });

  it("parses tld list files", () => {
    const set = parseTldFile("# comment\n.com\n DE \n\njp\n");
    assert.deepEqual([...set].sort(), ["com", "de", "jp"]);
  });

  it("honors TLD_WHITELIST override", () => {
    process.env.TLD_WHITELIST = "de, jp";
    assert.ok(isAllowedEnglishTld("example.de"));
    assert.ok(isAllowedEnglishTld("foo.jp"));
    assert.equal(isAllowedEnglishTld("example.com"), false);
  });
});

describe("language crawl priority", () => {
  it("uses data/language-priority.txt defaults", () => {
    loadLanguagePriorityConfig(true);
    assert.equal(crawlPriorityAdjustForLanguage(null), 0);
    assert.equal(crawlPriorityAdjustForLanguage(""), 0);
    assert.equal(crawlPriorityAdjustForLanguage("en"), 0);
    assert.equal(crawlPriorityAdjustForLanguage("mul"), -10);
    assert.equal(crawlPriorityAdjustForLanguage("ja"), -50);
  });

  it("parses language priority files", () => {
    const cfg = parseLanguagePriorityFile(`
# comment
en 0
mul -5
fr -20
default -40
`);
    assert.equal(cfg.languages.en, 0);
    assert.equal(cfg.languages.mul, -5);
    assert.equal(cfg.languages.fr, -20);
    assert.equal(cfg.default, -40);
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
