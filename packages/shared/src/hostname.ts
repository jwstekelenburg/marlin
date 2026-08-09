const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const HOSTNAME =
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

/**
 * Canonical host for dedup. Lowercase, strip trailing dot and leading www.,
 * reject IPs / localhost / names without a dot. Spider and worker must both use this.
 */
export function normalizeHost(input: string): string | null {
  let value = input.trim().toLowerCase();
  if (!value) return null;

  try {
    if (value.includes("://")) {
      value = new URL(value).hostname;
    } else if (value.includes("/") || value.includes("?") || value.includes(":")) {
      value = new URL(`https://${value}`).hostname;
    }
  } catch {
    return null;
  }

  value = value.replace(/\.$/, "");
  if (value.startsWith("www.")) value = value.slice(4);

  if (!value || value === "localhost") return null;
  if (IPV4.test(value)) return null;
  if (value.includes(":")) return null;
  if (!HOSTNAME.test(value)) return null;

  return value;
}

export function hostToUrl(host: string, protocol: "https" | "http" = "https"): string {
  return `${protocol}://${host}/`;
}
