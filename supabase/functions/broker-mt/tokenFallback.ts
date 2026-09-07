/**
 * Pure MetaApi token-fallback decision logic for the broker-mt bridge.
 *
 * The platform can trade a user's MT4/5 account through two MetaApi tokens:
 *   1. the user's OWN free MetaApi token (encrypted at rest on the connection),
 *   2. the platform-wide `METAAPI_TOKEN` secret (general token).
 *
 * Historically the fallback from "user" to "general" only happened when the
 * user had NO saved token at all. This module adds the RUNTIME fallback: when
 * the user HAS a token but MetaApi rejects it (revoked / invalid / rate- or
 * permission-limited), the bridge automatically switches to the general token
 * so the robot keeps trading — without surfacing an error to the user. A
 * caller-side notification hook reports the switch to the admins once per
 * connection.
 *
 * This file is intentionally dependency-free (no Deno, no DOM, no npm) so the
 * exact same decision logic can be unit-tested from the vitest suite.
 */

export type MetaTokenMode = "user" | "general";

export type MetaTokenSource = "user" | "general";

/** A candidate token together with the role it plays for this connection. */
export interface TokenCandidate {
  token: string;
  source: MetaTokenSource;
}

/** Token availability facts — everything the resolver needs except the check. */
export interface TokenCandidateOptions {
  /** Admin-selected token mode (defaults to 'user' when unset). */
  mode: MetaTokenMode;
  /** The user's own MetaApi token, decrypted, or null when they never saved one. */
  userToken: string | null;
  /** The platform-wide METAAPI_TOKEN secret, or null when unset. */
  platformToken: string | null;
}

/**
 * The input to the fallback resolver.
 *
 * `check` is injected so the resolver stays pure: the caller supplies the
 * live MetaApi validation (or a stub in tests). It must resolve the token
 * against the MetaApi provisioning API and report whether MetaApi accepts it.
 */
export interface ResolveTokenContext extends TokenCandidateOptions {
  check: (token: string) => Promise<{ ok: boolean; reason?: string }>;
}

export interface ResolveTokenResult {
  /** The token live trading should use, or null when every candidate is unusable. */
  token: string | null;
  /** Which role the chosen token plays ('user' | 'general'), or null. */
  source: MetaTokenSource | null;
  /**
   * Non-null when a higher-priority candidate was tried and FAILED (i.e. the
   * fallback actually engaged). Exactly this value is what triggers the admin
   * notification — it is null both on a clean user-token success and when the
   * user simply never added a token (that is the designed default, not a
   * failure to report).
   */
  fallbackReason: string | null;
  /** The candidate list actually probed, in priority order (for callers and tests). */
  candidates: TokenCandidate[];
}

/** The MetaApi validation failure reason for a candidate, human-readable. */
function failureReason(source: MetaTokenSource, reason?: string): string {
  const label = source === "user" ? "your saved MetaApi token" : "the platform METAAPI_TOKEN secret";
  return reason ? `${label}: ${reason}` : `${label} was rejected by MetaApi`;
}

/**
 * The ordered candidate list the resolver probes in priority order:
 *  - mode 'user'    → the user's own token first, platform token second;
 *  - mode 'general' → the platform token only (per-user tokens are ignored).
 */
export function metaTokenCandidates(o: TokenCandidateOptions): TokenCandidate[] {
  const candidates: TokenCandidate[] = [];
  if (o.mode === "general") {
    if (o.platformToken) candidates.push({ token: o.platformToken, source: "general" });
  } else {
    if (o.userToken) candidates.push({ token: o.userToken, source: "user" });
    if (o.platformToken) candidates.push({ token: o.platformToken, source: "general" });
  }
  return candidates;
}

/**
 * Resolve which MetaApi token a request should run through, in priority order:
 *
 *  - mode 'general'            → platformToken only (per-user tokens ignored).
 *  - mode 'user' + no user token → platformToken (the standard designed default).
 *  - mode 'user' + user token  → the user's token when MetaApi accepts it,
 *                                otherwise the platformToken as the automatic
 *                                fallback (the robot keeps working).
 *
 * `check` is called at most once per candidate. The first accepted candidate
 * wins; `fallbackReason` is the rejection reason of the earlier candidate when
 * a fallback occurred, and null otherwise.
 */
export async function resolveTokenWithFallback(input: ResolveTokenContext): Promise<ResolveTokenResult> {
  const candidates = metaTokenCandidates(input);

  if (candidates.length === 0) {
    return { token: null, source: null, fallbackReason: null, candidates };
  }

  let firstFailure: string | null = null;
  for (const candidate of candidates) {
    const verdict = await input.check(candidate.token);
    if (verdict.ok) {
      // A fallback fired only when a HIGHER-priority candidate existed and was
      // attempted but rejected — never when the user just has no token yet.
      return { token: candidate.token, source: candidate.source, fallbackReason: firstFailure, candidates };
    }
    if (firstFailure === null) {
      firstFailure = failureReason(candidate.source, verdict.reason);
    }
  }
  // Every candidate was unusable — the caller surfaces the last reason.
  return { token: null, source: null, fallbackReason: firstFailure, candidates };
}