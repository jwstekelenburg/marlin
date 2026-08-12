import dns from "node:dns/promises";
import net from "node:net";

/** Reject loopback, RFC1918, link-local, CGNAT, ULA, and cloud metadata ranges. */
export function isNonPublicIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return isNonPublicIpv4(ip);
  if (family === 6) return isNonPublicIpv6(ip);
  return true;
}

function ipv4ToInt(ip: string): number {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return -1;
  }
  return ((parts[0]! << 24) >>> 0) + (parts[1]! << 16) + (parts[2]! << 8) + parts[3]!;
}

function inCidr(ipInt: number, base: string, prefix: number): boolean {
  const baseInt = ipv4ToInt(base);
  if (baseInt < 0 || ipInt < 0) return false;
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

function isNonPublicIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n < 0) return true;
  // 0.0.0.0/8, 10/8, 127/8, 169.254/16, 172.16/12, 192.168/16, 100.64/10 (CGNAT),
  // 192.0.0.0/24, 192.0.2.0/24, 198.18/15, 198.51.100/24, 203.0.113/24, 224/4, 240/4
  return (
    inCidr(n, "0.0.0.0", 8) ||
    inCidr(n, "10.0.0.0", 8) ||
    inCidr(n, "127.0.0.0", 8) ||
    inCidr(n, "169.254.0.0", 16) ||
    inCidr(n, "172.16.0.0", 12) ||
    inCidr(n, "192.168.0.0", 16) ||
    inCidr(n, "100.64.0.0", 10) ||
    inCidr(n, "192.0.0.0", 24) ||
    inCidr(n, "192.0.2.0", 24) ||
    inCidr(n, "198.18.0.0", 15) ||
    inCidr(n, "198.51.100.0", 24) ||
    inCidr(n, "203.0.113.0", 24) ||
    inCidr(n, "224.0.0.0", 4) ||
    inCidr(n, "240.0.0.0", 4)
  );
}

function isNonPublicIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();

  // IPv4-mapped / IPv4-compatible mixed forms
  const mappedDot = normalized.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mappedDot) return isNonPublicIpv4(mappedDot[1]!);

  const buf = parseIpv6ToBytes(normalized);
  if (!buf) return true;

  // ::1
  if (buf.every((b, i) => (i === 15 ? b === 1 : b === 0))) return true;
  // ::
  if (buf.every((b) => b === 0)) return true;
  // fe80::/10
  if (buf[0] === 0xfe && (buf[1]! & 0xc0) === 0x80) return true;
  // fc00::/7 (ULA)
  if ((buf[0]! & 0xfe) === 0xfc) return true;
  // multicast ff00::/8
  if (buf[0] === 0xff) return true;
  // IPv4-mapped ::ffff:x.x.x.x
  if (
    buf.slice(0, 10).every((b) => b === 0) &&
    buf[10] === 0xff &&
    buf[11] === 0xff
  ) {
    return isNonPublicIpv4(`${buf[12]}.${buf[13]}.${buf[14]}.${buf[15]}`);
  }
  return false;
}

function parseIpv6ToBytes(ip: string): number[] | null {
  const lower = ip.toLowerCase();
  if (lower.includes(".")) {
    // mixed IPv4 tail handled by caller via mapped regex usually
    const lastColon = lower.lastIndexOf(":");
    const v4 = lower.slice(lastColon + 1);
    if (net.isIP(v4) === 4) {
      const head = lower.slice(0, lastColon);
      const parts = v4.split(".").map(Number);
      const hexTail = [
        ((parts[0]! << 8) | parts[1]!).toString(16),
        ((parts[2]! << 8) | parts[3]!).toString(16),
      ];
      return parseIpv6ToBytes(`${head}:${hexTail[0]}:${hexTail[1]}`);
    }
  }

  const [left, right = ""] = lower.split("::");
  const leftParts = left ? left.split(":").filter(Boolean) : [];
  const rightParts = right ? right.split(":").filter(Boolean) : [];
  if (leftParts.length + rightParts.length > 8) return null;
  const missing = 8 - leftParts.length - rightParts.length;
  if (missing < 0) return null;
  if (!lower.includes("::") && missing !== 0) return null;
  const groups = [
    ...leftParts,
    ...Array.from({ length: lower.includes("::") ? missing : 0 }, () => "0"),
    ...rightParts,
  ];
  if (groups.length !== 8) return null;
  const bytes: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    const n = Number.parseInt(g, 16);
    bytes.push((n >> 8) & 0xff, n & 0xff);
  }
  return bytes;
}

/**
 * Ensure a crawl URL is http(s) and resolves only to public addresses.
 * Call before each hop (including redirects). Throws on unsafe targets.
 */
export async function assertSafeFetchUrl(urlString: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new Error(`unsafe fetch url: invalid URL`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`unsafe fetch url: blocked scheme ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new Error(`unsafe fetch url: userinfo not allowed`);
  }

  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host || host.toLowerCase() === "localhost") {
    throw new Error(`unsafe fetch url: blocked host`);
  }

  if (net.isIP(host)) {
    if (isNonPublicIp(host)) {
      throw new Error(`unsafe fetch url: non-public IP ${host}`);
    }
    return;
  }

  let records: Array<{ address: string; family: number }>;
  try {
    records = await dns.lookup(host, { all: true, verbatim: true });
  } catch (err) {
    throw new Error(
      `unsafe fetch url: DNS failed for ${host}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
  if (!records.length) {
    throw new Error(`unsafe fetch url: no DNS records for ${host}`);
  }
  for (const rec of records) {
    if (isNonPublicIp(rec.address)) {
      throw new Error(`unsafe fetch url: ${host} resolves to non-public IP ${rec.address}`);
    }
  }
}
