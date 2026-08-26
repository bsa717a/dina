import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  pwaIdentityForKey,
  resolvePwaIdentity,
  webAppManifest,
} from "@/lib/pwa/identity";

const requireSession = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  requireSession: () => requireSession(),
}));

describe("pwaIdentityForKey", () => {
  it("keeps Dina as the default install identity", () => {
    const identity = pwaIdentityForKey(null);
    expect(identity.key).toBe("dina");
    expect(identity.name).toBe("Dina");
    expect(identity.icon192).toBe("/icons/icon-192.png?v=3");
    expect(identity.appleTouchIcon).toBe("/icons/apple-touch-icon.png?v=3");
    expect(identity.manifestUrl).toBe("/manifest.webmanifest?assistant=dina");
  });

  it("uses the teammate's assistant portrait and name", () => {
    const identity = pwaIdentityForKey("nora");
    expect(identity.name).toBe("Nora");
    expect(identity.icon192).toBe("/icons/nora/icon-192.png?v=1");
    expect(identity.appleTouchIcon).toBe("/icons/nora/apple-touch-icon.png?v=1");
    expect(identity.manifestUrl).toBe("/manifest.webmanifest?assistant=nora");
  });
});

describe("resolvePwaIdentity", () => {
  it("prefers a known query key so install can use a unique manifest URL", () => {
    const identity = resolvePwaIdentity({
      assistantKey: "mac",
      fallbackKey: "nora",
    });
    expect(identity.key).toBe("mac");
  });

  it("falls back to the session assistant, then Dina", () => {
    expect(
      resolvePwaIdentity({ assistantKey: "unknown", fallbackKey: "penny" }).key,
    ).toBe("penny");
    expect(resolvePwaIdentity({ assistantKey: "nope" }).key).toBe("dina");
  });
});

describe("webAppManifest", () => {
  it("names the installed app after the chosen assistant", () => {
    const manifest = webAppManifest(pwaIdentityForKey("addie"));
    expect(manifest.name).toBe("Addie");
    expect(manifest.short_name).toBe("Addie");
    expect(manifest.icons[0]?.src).toContain("/icons/addie/icon-192.png");
  });
});

describe("GET /manifest.webmanifest", () => {
  beforeEach(() => {
    vi.resetModules();
    requireSession.mockReset();
  });

  it("returns Dina when nobody is signed in", async () => {
    requireSession.mockResolvedValue(null);
    const { GET } = await import("@/app/manifest.webmanifest/route");
    const res = await GET(new Request("http://localhost:8080/manifest.webmanifest"));
    const body = await res.json();
    expect(res.headers.get("content-type")).toMatch(/manifest|json/);
    expect(body.name).toBe("Dina");
    expect(body.icons[0].src).toBe("/icons/icon-192.png?v=3");
  });

  it("returns the teammate assistant from the query string", async () => {
    requireSession.mockResolvedValue(null);
    const { GET } = await import("@/app/manifest.webmanifest/route");
    const res = await GET(
      new Request("http://localhost:8080/manifest.webmanifest?assistant=nora"),
    );
    const body = await res.json();
    expect(body.name).toBe("Nora");
    expect(body.short_name).toBe("Nora");
    expect(body.icons[0].src).toBe("/icons/nora/icon-192.png?v=1");
  });

  it("uses the signed-in assistant when the query is missing", async () => {
    requireSession.mockResolvedValue({
      assistantKey: "penny",
    });
    const { GET } = await import("@/app/manifest.webmanifest/route");
    const res = await GET(new Request("http://localhost:8080/manifest.webmanifest"));
    const body = await res.json();
    expect(body.name).toBe("Penny");
    expect(body.icons[0].src).toContain("/icons/penny/");
  });
});
