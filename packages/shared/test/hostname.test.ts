import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hostToUrl, normalizeHost } from "../src/hostname.js";

describe("normalizeHost", () => {
  it("lowercases and strips leading www.", () => {
    assert.equal(normalizeHost("WWW.Example.COM"), "example.com");
    assert.equal(normalizeHost("www.example.com"), "example.com");
  });

  it("strips trailing dots", () => {
    assert.equal(normalizeHost("example.com."), "example.com");
  });

  it("parses URLs and path-like inputs", () => {
    assert.equal(normalizeHost("https://www.Example.com/path?q=1"), "example.com");
    assert.equal(normalizeHost("example.com/foo"), "example.com");
    assert.equal(normalizeHost("example.com:443"), "example.com");
  });

  it("rejects empty, localhost, IPs, and single-label names", () => {
    assert.equal(normalizeHost(""), null);
    assert.equal(normalizeHost("   "), null);
    assert.equal(normalizeHost("localhost"), null);
    assert.equal(normalizeHost("127.0.0.1"), null);
    assert.equal(normalizeHost("192.168.1.1"), null);
    assert.equal(normalizeHost("intranet"), null);
  });

  it("rejects unicode hostnames (ASCII / punycode only)", () => {
    assert.equal(normalizeHost("münchen.de"), null);
    assert.equal(normalizeHost("例え.jp"), null);
  });

  it("accepts punycode labels", () => {
    assert.equal(normalizeHost("xn--mnchen-3ya.de"), "xn--mnchen-3ya.de");
  });

  it("rejects garbage", () => {
    assert.equal(normalizeHost("not a host!!!"), null);
    assert.equal(normalizeHost("http://"), null);
  });
});

describe("hostToUrl", () => {
  it("builds an https URL by default", () => {
    assert.equal(hostToUrl("example.com"), "https://example.com/");
    assert.equal(hostToUrl("example.com", "http"), "http://example.com/");
  });
});
