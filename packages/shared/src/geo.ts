import Iso6391 from "iso-639-1";

/** ISO 3166-1 alpha-2 (current assigned codes). */
const ISO3166_ALPHA2 = new Set(
  `
AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ
BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ
CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ
DE DJ DK DM DO DZ
EC EE EG EH ER ES ET
FI FJ FK FM FO FR
GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY
HK HM HN HR HT HU
ID IE IL IM IN IO IQ IR IS IT
JE JM JO JP
KE KG KH KI KM KN KP KR KW KY KZ
LA LB LC LI LK LR LS LT LU LV LY
MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ
NA NC NE NF NG NI NL NO NP NR NU NZ
OM
PA PE PF PG PH PK PL PM PN PR PS PT PW PY
QA
RE RO RS RU RW
SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ
TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ
UA UG UM US UY UZ
VA VC VE VG VI VN VU
WF WS
YE YT
ZA ZM ZW
`
    .trim()
    .split(/\s+/),
);

const EMPTY = new Set([
  "",
  "-",
  "n/a",
  "na",
  "none",
  "null",
  "unknown",
  "unspecified",
  "n.a.",
  "not applicable",
]);

const NOT_A_PLACE = new Set([
  ...EMPTY,
  "global",
  "worldwide",
  "world",
  "international",
  "internet",
  "online",
  "various",
  "multiple",
  "everywhere",
  "remote",
]);

const COUNTRY_ALIASES: Record<string, string> = {
  uk: "GB",
  "great britain": "GB",
  britain: "GB",
  england: "GB",
  scotland: "GB",
  wales: "GB",
  "united kingdom": "GB",
  el: "GR",
  usa: "US",
  "united states of america": "US",
  "united states": "US",
  america: "US",
  holland: "NL",
  "the netherlands": "NL",
  "south korea": "KR",
  "north korea": "KP",
  russia: "RU",
  "viet nam": "VN",
  vietnam: "VN",
  "czech republic": "CZ",
  czechia: "CZ",
  "ivory coast": "CI",
  "cote d'ivoire": "CI",
  "côte d'ivoire": "CI",
  "south africa": "ZA",
  "new zealand": "NZ",
  "hong kong": "HK",
  taiwan: "TW",
  palestine: "PS",
  "united arab emirates": "AE",
  uae: "AE",
};

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
const languageNames = new Intl.DisplayNames(["en"], { type: "language" });

const COUNTRY_NAME_TO_CODE = new Map<string, string>();
for (const code of ISO3166_ALPHA2) {
  const name = regionNames.of(code);
  if (name) COUNTRY_NAME_TO_CODE.set(name.toLowerCase(), code);
}
for (const [alias, code] of Object.entries(COUNTRY_ALIASES)) {
  COUNTRY_NAME_TO_CODE.set(alias, code);
}

function blankish(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function isIso3166Alpha2(code: string): boolean {
  return ISO3166_ALPHA2.has(code.toUpperCase());
}

export function countryDisplayName(code: string): string {
  try {
    return regionNames.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

export function languageDisplayName(code: string): string {
  if (code === "mul") return "multiple";
  try {
    return languageNames.of(code) ?? code;
  } catch {
    return code;
  }
}

/** ISO 639-1, or `mul`. Empty/unknown → null. */
export function normalizeLanguage(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const t = blankish(raw);
  if (EMPTY.has(t)) return null;
  if (t === "mul" || t === "multilingual" || t === "mixed" || t === "bilingual") return "mul";

  const primary = t.split(/[-_/]/)[0] ?? "";
  if (primary.length === 2 && Iso6391.validate(primary)) return primary;

  const fromName = Iso6391.getCode(t);
  if (fromName) return fromName.toLowerCase();

  return null;
}

/** ISO 3166-1 alpha-2. Empty / global / multi → null. UK → GB. */
export function normalizeCountry(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const t = blankish(raw);
  if (EMPTY.has(t) || NOT_A_PLACE.has(t)) return null;
  if (t === "multi" || t === "multiple countries" || t === "eu" || t === "europe") return null;

  if (t.length === 2 && ISO3166_ALPHA2.has(t.toUpperCase())) return t.toUpperCase();
  if (COUNTRY_ALIASES[t]) return COUNTRY_ALIASES[t];

  const fromName = COUNTRY_NAME_TO_CODE.get(t);
  if (fromName) return fromName;

  return null;
}

/** Short place phrase. Empty / global waffle → null. */
export function normalizePlace(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const t = raw.trim().replace(/\s+/g, " ");
  if (!t || NOT_A_PLACE.has(t.toLowerCase())) return null;
  if (t.length > 80) return t.slice(0, 80).trim();
  return t;
}
