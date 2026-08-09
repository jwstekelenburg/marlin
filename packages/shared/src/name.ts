const GENERIC_NAME =
  /^(university|college|school|hospital|institute|academy|website|homepage|home|welcome|official|blog|shop|store|company|organization|news|forum|wiki|docs|documentation|untitled|index|portal|site)$/i;

export function cleanPageTitle(title: string, host: string): string {
  let value = title.replace(/\s+/g, " ").trim();
  if (!value) return "";

  value = value.replace(
    /\s*[-|–—:·•]\s*(home|homepage|official\s+site|official\s+website|welcome|index)\s*$/i,
    "",
  );

  const hostBare = host.replace(/^www\./, "").toLowerCase();
  const hostNoDots = hostBare.replace(/\./g, "");
  const parts = value
    .split(/\s*[-|–—·•]\s+/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length === 0) return value.slice(0, 80);

  let best = parts[0]!;
  let bestScore = -Infinity;
  for (const part of parts) {
    const lower = part.toLowerCase().replace(/\s+/g, "");
    let score = part.length;
    if (GENERIC_NAME.test(part)) score -= 40;
    if (/home|welcome|official|index/i.test(part)) score -= 20;
    if (lower === hostBare || lower === hostNoDots || lower.includes(hostBare)) score -= 25;
    if (/[A-Z]/.test(part) && part.includes(" ")) score += 12;
    if (score > bestScore) {
      bestScore = score;
      best = part;
    }
  }

  return best.slice(0, 80);
}

export function pickSiteName(input: {
  llmName: string;
  title: string;
  host: string;
  category: string;
}): string {
  const cleaned = cleanPageTitle(input.title, input.host);
  const llm = input.llmName.trim();

  if (!llm) return cleaned || input.host;
  if (GENERIC_NAME.test(llm) && cleaned) return cleaned;
  if (llm.toLowerCase() === input.category && cleaned) return cleaned;

  const llmWords = llm.split(/\s+/).filter(Boolean);
  const cleanedWords = cleaned.split(/\s+/).filter(Boolean);
  if (llmWords.length === 1 && llm.length <= 14 && cleanedWords.length >= 2) return cleaned;

  return llm;
}
