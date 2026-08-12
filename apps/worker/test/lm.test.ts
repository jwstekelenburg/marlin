import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { catalogPage, type LmClient } from "../src/lm.js";

const lm: LmClient = {
  baseUrl: "http://lm.test/v1",
  model: "test-model",
  apiKey: "test",
  timeoutMs: 5_000,
  textChars: 4000,
};

const prose =
  "Acme sells widgets to small businesses worldwide. The homepage shows product categories, pricing tiers, and a support contact form for buyers.";

function chatResponse(content: string, status = 200): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content } }] }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

function catalogJson(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    name: "Acme",
    summary: prose,
    category: "ecommerce",
    tags: ["widgets", "b2b"],
    language: "en",
    place: "",
    country: "",
    ...overrides,
  });
}

afterEach(() => {
  mock.restoreAll();
});

describe("catalogPage", () => {
  it("returns a parsed catalog on a good structured response", async () => {
    mock.method(globalThis, "fetch", async () => chatResponse(catalogJson()));

    const result = await catalogPage({
      url: "https://acme.com/",
      title: "Acme",
      text: prose,
      lm,
    });
    assert.equal(result.category, "ecommerce");
    assert.equal(result.tags.length, 2);
    assert.match(result.summary, /widgets/);
  });

  it("retries prompt-only after malformed JSON, then succeeds", async () => {
    let calls = 0;
    const fetchMock = mock.method(globalThis, "fetch", async () => {
      calls += 1;
      if (calls === 1) return chatResponse("not json at all");
      return chatResponse(catalogJson());
    });

    const result = await catalogPage({
      url: "https://acme.com/",
      title: "Acme",
      text: prose,
      lm,
    });
    assert.equal(result.category, "ecommerce");
    assert.equal(calls, 2);
    assert.equal(fetchMock.mock.callCount(), 2);
  });

  it("retries after a thin summary, then fails if retry is still thin", async () => {
    mock.method(globalThis, "fetch", async () =>
      chatResponse(
        catalogJson({
          summary: "ecommerce",
          category: "ecommerce",
          tags: ["ecommerce"],
        }),
      ),
    );

    await assert.rejects(
      () =>
        catalogPage({
          url: "https://acme.com/",
          title: "Acme",
          text: prose,
          lm,
        }),
      /summary too thin after retry/,
    );
  });

  it("does not retry context-exceeded errors", async () => {
    let calls = 0;
    mock.method(
      globalThis,
      "fetch",
      async () => {
        calls += 1;
        return new Response("context size has been exceeded", {
          status: 400,
          headers: { "Content-Type": "text/plain" },
        });
      },
    );

    await assert.rejects(
      () =>
        catalogPage({
          url: "https://acme.com/",
          title: "Acme",
          text: prose,
          lm,
        }),
      /context size has been exceeded/i,
    );
    assert.equal(calls, 1);
  });

  it("extracts JSON embedded in prose on retry", async () => {
    let calls = 0;
    mock.method(globalThis, "fetch", async () => {
      calls += 1;
      if (calls === 1) {
        return chatResponse("sorry, here you go:\n" + catalogJson({ summary: "blog" }));
      }
      return chatResponse("Sure!\n" + catalogJson() + "\nThanks");
    });

    const result = await catalogPage({
      url: "https://acme.com/",
      title: "Acme",
      text: prose,
      lm,
    });
    assert.equal(result.category, "ecommerce");
    assert.equal(calls, 2);
  });

  it("rejects missing required catalog fields after retry", async () => {
    mock.method(globalThis, "fetch", async () =>
      chatResponse(JSON.stringify({ name: "Acme", tags: [] })),
    );

    await assert.rejects(
      () =>
        catalogPage({
          url: "https://acme.com/",
          title: "Acme",
          text: prose,
          lm,
        }),
      /missing summary/,
    );
  });
});
