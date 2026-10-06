// Turns a raw card-statement description into the merchant name an expense is
// saved under: "ROGERS *************3771" -> "Rogers", "TELUS MOBILITY EDMONTON"
// -> "Telus Mobility", "CANADA SPORTSWEAR CORP 416-7408020" -> "Canada Sportswear
// Corp". Only the saved expense's merchant_name is cleaned; the statement line
// keeps the original description. Pure and import-free so it unit-tests directly.
//
// Deliberately conservative - a wrong strip loses information, a missed one is
// just untidy:
//  - masked numbers: only RUNS of 2+ asterisks/bullets (or XXXX) plus the digits
//    after them. A single "*" is a processor separator ("SQ *COFFEE SHOP") and the
//    name after it is kept.
//  - phone numbers: only phone-shaped digit groups (3-3-4, optional country code).
//    Store numbers like "#7042" are kept - they tell two branches apart.
//  - location: a trailing province code, then a trailing city from a list of
//    Canadian cities. An unlisted city is left alone rather than guessed at, and a
//    city that follows "of" ("BANK OF MONTREAL") is part of the name, not a location.
//  - casing: only re-cased when the text is ALL CAPS (as statements print it); text
//    that already has lowercase letters is left as the issuer wrote it.
// If cleaning would leave nothing, the original text is used.

const MAX_LENGTH = 200;

const PROVINCE_CODES = new Set(["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "PQ", "QC", "SK", "YT"]);

// Lowercase. Multi-word cities are matched against the last 1-3 words.
const CITIES = new Set([
  // Ontario
  "toronto", "mississauga", "brampton", "hamilton", "london", "markham", "vaughan", "kitchener", "windsor",
  "richmond hill", "oakville", "burlington", "oshawa", "barrie", "guelph", "cambridge", "waterloo", "ottawa",
  "kingston", "sudbury", "greater sudbury", "thunder bay", "peterborough", "pickering", "ajax", "whitby",
  "newmarket", "aurora", "milton", "etobicoke", "scarborough", "north york", "st catharines",
  "saint catharines", "niagara falls", "brantford", "sarnia", "belleville", "welland", "cobourg", "orillia",
  "stouffville", "whitchurch-stouffville", "bowmanville", "clarington", "georgetown", "halton hills",
  "woodbridge", "concord", "thornhill", "bolton", "caledon", "innisfil", "bradford", "stratford", "woodstock",
  "orangeville", "collingwood", "sault ste marie", "north bay", "timmins", "cornwall", "kanata", "nepean",
  "gloucester", "orleans", "stoney creek", "ancaster", "dundas", "grimsby", "fort erie", "port colborne",
  "lindsay", "keswick", "uxbridge", "midland", "tillsonburg", "chatham", "leamington", "kenora",
  // West
  "edmonton", "calgary", "red deer", "lethbridge", "medicine hat", "grande prairie", "airdrie", "st albert",
  "fort mcmurray", "vancouver", "burnaby", "surrey", "richmond", "victoria", "kelowna", "abbotsford",
  "coquitlam", "langley", "nanaimo", "kamloops", "delta", "north vancouver", "west vancouver", "saanich",
  "winnipeg", "brandon", "regina", "saskatoon", "prince albert",
  // Quebec and Atlantic
  "montreal", "quebec", "quebec city", "laval", "gatineau", "longueuil", "sherbrooke", "halifax", "dartmouth",
  "moncton", "fredericton", "saint john", "st johns", "st john's", "charlottetown", "sydney",
]);

// Words that, directly before a city, mean it is part of the name rather than a
// location: BANK OF MONTREAL, UNIVERSITY OF TORONTO, CITY OF HAMILTON.
const NAME_JOINERS = new Set(["of", "de", "du", "des", "the", "la", "le", "d'"]);

// Stay upper-case when re-casing (initialisms and stylised brands).
const KEEP_UPPER = new Set([
  "LCBO", "TD", "RBC", "BMO", "CIBC", "KFC", "IKEA", "HBC", "MEC", "IGA", "UPS", "USPS", "DHL", "TTC", "LLC",
  "USA", "ATM", "HST", "GST", "LRT", "GO", "CN", "CP", "MTS", "BCAA", "CAA", "AAA", "ABC", "RONA", "LDS",
]);

// 416-740-8020, (416) 740-8020, 416.740.8020, 4167408020, 416-7408020, +1 416 740 8020.
const PHONE = /(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\b\d{3})[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
// Runs of 2+ asterisks/bullets (a masked card or account number), with any digits
// after them; or a run of X's used as the mask.
const MASKED = /[*•]{2,}\s*\d*|\bX{4,}\s*\d*/g;

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function trimSeparators(text: string): string {
  return text.replace(/^[\s\-–—,.;:/\\|]+|[\s\-–—,.;:/\\|]+$/g, "");
}

function stripTrailingLocation(text: string): string {
  let words = text.split(" ").filter(Boolean);

  // A trailing province code (statements print these in capitals, so a lowercase
  // "on" in a mixed-case name is left alone).
  while (words.length > 1 && PROVINCE_CODES.has(words[words.length - 1])) {
    words = words.slice(0, -1);
  }

  // A trailing city: try the longest suffix first ("sault ste marie", "north york").
  for (let n = Math.min(3, words.length - 1); n >= 1; n--) {
    const candidate = words.slice(-n).join(" ").toLowerCase().replace(/[.,]$/, "");
    const before = words[words.length - n - 1]?.toLowerCase();
    if (CITIES.has(candidate) && !(before && NAME_JOINERS.has(before))) {
      words = words.slice(0, -n);
      break;
    }
  }
  return words.join(" ");
}

function titleWord(word: string): string {
  const bare = word.replace(/[^A-Za-z]/g, "");
  if (bare && KEEP_UPPER.has(bare)) return word;
  // Short initialism joined by an ampersand: A&W, H&M, M&M.
  if (/^[A-Z]{1,2}&[A-Z]{1,2}$/.test(word)) return word;
  // Capitalise after the start of the word and after an apostrophe or hyphen:
  // "TIM HORTON'S" -> "Tim Horton's" (the letter after an apostrophe+s stays lower),
  // "COCA-COLA" -> "Coca-Cola".
  return word
    .toLowerCase()
    .replace(/(^|-)([a-z])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase())
    .replace(/(^|\s)([a-z])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

function normalizeCase(text: string): string {
  const letters = text.replace(/[^A-Za-z]/g, "");
  if (!letters || letters !== letters.toUpperCase()) return text; // already has lowercase: leave it
  return text
    .split(" ")
    .map((word, i) => {
      // "of", "the", "and" stay lowercase inside a name (Bank of Montreal) but not first.
      const lower = word.toLowerCase();
      if (i > 0 && (NAME_JOINERS.has(lower) || lower === "and")) return lower;
      return titleWord(word);
    })
    .join(" ");
}

export function cleanMerchantName(description: string): string {
  const original = collapse(description ?? "").slice(0, MAX_LENGTH);
  if (!original) return "";

  let name = original
    .replace(MASKED, " ")
    .replace(PHONE, " ")
    // What's left of a lone "*" is a separator (SQ *NAME, PAYPAL *NAME).
    .replace(/\*/g, " ");
  name = trimSeparators(collapse(name));
  name = trimSeparators(collapse(stripTrailingLocation(name)));

  // Never turn a real description into nothing.
  if (!name) return normalizeCase(trimSeparators(original) || original);
  return normalizeCase(name).slice(0, MAX_LENGTH);
}
