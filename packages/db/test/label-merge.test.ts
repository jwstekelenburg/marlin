import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyLabelAliases,
  getLabelAliasMaps,
  parseAliasFile,
  resolveAliasMap,
} from "../src/label-merge.js";

describe("parseAliasFile / resolveAliasMap", () => {
  it("parses and chains aliases", () => {
    const aliases = parseAliasFile(`
# comment
tag  popculture  pop-culture
tag  pop culture  popculture
category  e-commerce  ecommerce
`);
    assert.deepEqual(resolveAliasMap(aliases, "tag").get("pop culture"), "pop-culture");
    assert.equal(resolveAliasMap(aliases, "category").get("e-commerce"), "ecommerce");
  });
});

describe("applyLabelAliases", () => {
  it("rewrites category and tags from the repo alias file", () => {
    const maps = getLabelAliasMaps(true);
    assert.ok(maps.tag.size > 0, "expected tag aliases in data/label-aliases.txt");

    const out = applyLabelAliases({
      category: "E-Commerce",
      tags: ["PopCulture", "pop-culture", "webdesign", "unique-tag"],
    });
    assert.equal(out.category, "ecommerce");
    assert.deepEqual(out.tags, ["pop-culture", "unique-tag", "web-design"]);
  });
});
