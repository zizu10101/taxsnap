// Basic title-casing for manually-entered employee names (e.g. "John DOe" ->
// "John Doe"), with special-casing for the common surname patterns that a
// naive per-word capitalize would mangle: "Mc-" (McDonald), "Mac-"
// (MacLeod, but not Mack/Mace/Machine), and apostrophes (O'Brien).
//
// This isn't a full name-casing library (no dependency exists for this in
// package.json, and pulling one in for a single small helper isn't worth
// it) - it's a hand-rolled heuristic modeled on the same rules those
// libraries use. It won't be right for every exotic name (e.g. "Macbeth"
// as a surname would become "MacBeth"), which is inherent to the problem,
// not a bug - see MAC_EXCEPTIONS below for the known common-word cases it
// deliberately excludes.

const MAC_EXCEPTIONS = new Set([
  "macro",
  "macaroni",
  "machine",
  "machinist",
  "mackintosh",
  "macaw",
  "macabre",
  "mackerel",
  "macadam",
  "maceration",
]);

function capitalizeSegment(segment: string): string {
  if (!segment) return segment;
  return segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase();
}

function capitalizeWord(word: string): string {
  if (!word) return word;
  const lower = word.toLowerCase();

  // "Mc-" (McDonald, McCarthy): capitalize the letter right after "Mc".
  if (lower.startsWith("mc") && lower.length > 2) {
    return "Mc" + capitalizeSegment(word.slice(2));
  }

  // "Mac-" (MacLeod, MacArthur): capitalize the letter right after "Mac",
  // but only for a long-enough remainder that isn't a known common word
  // (Mack/Mace/Macy/Mach are all caught by the length check alone since
  // they're exactly 4 letters; longer common words need the exception list).
  if (lower.startsWith("mac") && lower.length > 4 && !MAC_EXCEPTIONS.has(lower)) {
    return "Mac" + capitalizeSegment(word.slice(3));
  }

  // Apostrophes (O'Brien, D'Angelo): capitalize the letter after each one.
  if (word.includes("'")) {
    return word.split("'").map(capitalizeSegment).join("'");
  }

  return capitalizeSegment(word);
}

export function toTitleCase(value: string): string {
  return value.trim().split(/\s+/).map(capitalizeWord).join(" ");
}
