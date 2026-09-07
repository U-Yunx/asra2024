/**
 * Unit tests for the pure MetaApi token-fallback decision logic.
 *
 * The logic lives in `supabase/functions/broker-mt/tokenFallback.ts` — it has
 * no Deno/runtime dependencies so the exact same file the edge function uses
 * can be exercised here. These tests pin the documented behaviour:
 *
 *  - mode 'user': the user's own token is attempted first; when MetaApi
 *    rejects it, the platform token takes over (fallbackReason set).
 *  - mode 'user' with NO user token: the platform token is the designed
 *    default — fallbackReason stays null (no admin notification).
 *  - mode 'general': only the platform token is ever used; user tokens are
 *    ignored entirely.
 *  - `check` is called at most once per candidate (no wasted validation).
 */
import { describe, expect, it, vi } from "vitest";
import {
  metaTokenCandidates,
  resolveTokenWithFallback,
  type MetaTokenSource,
} from "../../../supabase/functions/broker-mt/tokenFallback.ts";

const USER = "user-token-1234567890";
const PLATFORM = "platform-token-1234567890";

/** Build a check stub that accepts/rejects tokens by an allow-list. */
function checker(accept: RegExp) {
  return vi.fn(async (t: string) =>
    accept.test(t) ? { ok: true } : { ok: false, reason: "MetaApi rejected this API token." },
  );
}

describe("metaTokenCandidates", () => {
  it("orders user-then-platform in 'user' mode when both exist", () => {
    const c = metaTokenCandidates({ mode: "user", userToken: USER, platformToken: PLATFORM });
    expect(c.map((x) => x.source)).toEqual<MetaTokenSource[]>(["user", "general"]);
    expect(c[0].token).toBe(USER);
  });

  it("lists only the platform token when the user has none", () => {
    const c = metaTokenCandidates({ mode: "user", userToken: null, platformToken: PLATFORM });
    expect(c.map((x) => x.source)).toEqual<MetaTokenSource[]>(["general"]);
  });

  it("ignores the user token entirely in general mode", () => {
    const c = metaTokenCandidates({ mode: "general", userToken: USER, platformToken: PLATFORM });
    expect(c).toHaveLength(1);
    expect(c[0].source).toBe("general");
    expect(c[0].token).toBe(PLATFORM);
  });

  it("returns an empty list when nothing is configured", () => {
    expect(metaTokenCandidates({ mode: "general", userToken: null, platformToken: null })).toEqual([]);
    expect(metaTokenCandidates({ mode: "user", userToken: null, platformToken: null })).toEqual([]);
  });
});

describe("resolveTokenWithFallback", () => {
  it("uses the user's own token when MetaApi accepts it (no fallback)", async () => {
    const check = checker(/^user-token/);
    const r = await resolveTokenWithFallback({
      mode: "user",
      userToken: USER,
      platformToken: PLATFORM,
      check,
    });
    expect(r.token).toBe(USER);
    expect(r.source).toBe("user");
    expect(r.fallbackReason).toBeNull();
    expect(check).toHaveBeenCalledTimes(1); // platform never probed
  });

  it("switches to the platform token when the user's token is rejected", async () => {
    const check = checker(/^platform-token/); // user rejected, platform ok
    const r = await resolveTokenWithFallback({
      mode: "user",
      userToken: USER,
      platformToken: PLATFORM,
      check,
    });
    expect(r.token).toBe(PLATFORM);
    expect(r.source).toBe("general");
    expect(r.fallbackReason).toContain("your saved MetaApi token");
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("does NOT report a fallback when the user token is missing entirely", async () => {
    const check = checker(/^platform-token/);
    const r = await resolveTokenWithFallback({
      mode: "user",
      userToken: null,
      platformToken: PLATFORM,
      check,
    });
    expect(r.token).toBe(PLATFORM);
    expect(r.source).toBe("general");
    expect(r.fallbackReason).toBeNull(); // designed default → no admin notification
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("uses the user token when the platform token is absent", async () => {
    const check = checker(/^user-token/);
    const r = await resolveTokenWithFallback({
      mode: "user",
      userToken: USER,
      platformToken: null,
      check,
    });
    expect(r.token).toBe(USER);
    expect(r.source).toBe("user");
    expect(r.fallbackReason).toBeNull();
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("returns null with a reason when every candidate is rejected", async () => {
    const check = checker(/^never-matches$/);
    const r = await resolveTokenWithFallback({
      mode: "user",
      userToken: USER,
      platformToken: PLATFORM,
      check,
    });
    expect(r.token).toBeNull();
    expect(r.source).toBeNull();
    expect(r.fallbackReason).toContain("your saved MetaApi token");
  });

  it("uses only the platform token in general mode, ignoring the user token", async () => {
    const check = checker(/^platform-token/);
    const r = await resolveTokenWithFallback({
      mode: "general",
      userToken: USER,
      platformToken: PLATFORM,
      check,
    });
    expect(r.token).toBe(PLATFORM);
    expect(r.source).toBe("general");
    expect(r.fallbackReason).toBeNull();
    expect(check).toHaveBeenCalledTimes(1); // user token never validated
  });

  it("keeps validation count down to one probe on the happy path", async () => {
    const check = checker(/^user-token/);
    await resolveTokenWithFallback({ mode: "user", userToken: USER, platformToken: PLATFORM, check });
    expect(check).toHaveBeenCalledTimes(1);
  });
});