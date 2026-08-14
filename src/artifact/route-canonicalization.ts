// Generic route canonicalization (brief's own stretch-goal language,
// Section 8): normalize a concrete URL into a reusable pattern by replacing
// path segments and query values that look like record identifiers with a
// named placeholder — /member?memberId=12345 -> /member?memberId=:memberId,
// /member/12345/new-subaccount -> /member/:id/new-subaccount.
//
// This is deliberately a general-purpose function, distinct from
// tenant-override.ts's per-step override merging (which edits locators
// directly for a known, specific difference). Canonicalization is about
// recognizing which parts of a URL are DATA rather than STRUCTURE, so the
// same pattern can be recognized/matched across records and, in principle,
// across tenants whose route structure otherwise matches.

const NUMERIC_SEGMENT = /^\d+$/;

export function canonicalizeRoute(url: string): string {
  const parsed = new URL(url);
  const segments = parsed.pathname.split("/").map((seg) => (NUMERIC_SEGMENT.test(seg) ? ":id" : seg));
  parsed.pathname = segments.join("/");

  for (const [key, value] of parsed.searchParams.entries()) {
    if (NUMERIC_SEGMENT.test(value)) {
      parsed.searchParams.set(key, `:${key}`);
    }
  }
  // URLSearchParams percent-encodes ":" (-> %3A); decode it back for a
  // readable canonical form (e.g. "?memberId=:memberId", not "%3AmemberId")
  // — this is just a display/matching key, not a URL that gets navigated to.
  return (parsed.pathname + (parsed.search ? parsed.search : "")).replace(/%3A/g, ":");
}
