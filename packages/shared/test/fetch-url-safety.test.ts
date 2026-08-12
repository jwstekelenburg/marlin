import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertSafeFetchUrl, isNonPublicIp } from "../src/fetch-url-safety.js";

describe("isNonPublicIp", () => {
  it("flags loopback, RFC1918, link-local, CGNAT, and metadata-ish ranges", () => {
    for (const ip of [
      "127.0.0.1",
      "0.0.0.0",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.0.1",
      "169.254.169.254",
      "100.64.0.1",
      "100.127.255.255",
      "192.0.2.1",
      "198.51.100.1",
      "203.0.113.1",
    ]) {
      assert.equal(isNonPublicIp(ip), true, ip);
    }
  });

  it("allows public IPv4", () => {
    assert.equal(isNonPublicIp("8.8.8.8"), false);
    assert.equal(isNonPublicIp("1.1.1.1"), false);
    assert.equal(isNonPublicIp("93.184.216.34"), false);
  });

  it("flags IPv6 loopback, ULA, link-local, multicast", () => {
    assert.equal(isNonPublicIp("::1"), true);
    assert.equal(isNonPublicIp("::"), true);
    assert.equal(isNonPublicIp("fe80::1"), true);
    assert.equal(isNonPublicIp("fc00::1"), true);
    assert.equal(isNonPublicIp("fd12:3456:789a::1"), true);
    assert.equal(isNonPublicIp("ff02::1"), true);
  });

  it("flags IPv4-mapped private addresses", () => {
    assert.equal(isNonPublicIp("::ffff:127.0.0.1"), true);
    assert.equal(isNonPublicIp("::ffff:192.168.1.1"), true);
  });
});

describe("assertSafeFetchUrl", () => {
  it("rejects non-http schemes and localhost", async () => {
    await assert.rejects(() => assertSafeFetchUrl("file:///etc/passwd"), /scheme|blocked/);
    await assert.rejects(() => assertSafeFetchUrl("http://localhost/"), /blocked/);
    await assert.rejects(() => assertSafeFetchUrl("http://127.0.0.1/"), /non-public/);
    await assert.rejects(() => assertSafeFetchUrl("http://169.254.169.254/latest"), /non-public/);
    await assert.rejects(() => assertSafeFetchUrl("http://user:pass@example.com/"), /userinfo/);
  });

  it("allows a public hostname after DNS", async () => {
    await assertSafeFetchUrl("https://example.com/");
  });
});
