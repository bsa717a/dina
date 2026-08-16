import { describe, expect, it } from "vitest";
import { cookieSecureForRequest } from "@/lib/auth/cookie-secure";

describe("cookieSecureForRequest", () => {
  it("is false for local HTTP with no forwarded proto", () => {
    expect(
      cookieSecureForRequest({ url: "http://localhost:8080/api/auth/login" }),
    ).toBe(false);
    expect(
      cookieSecureForRequest({ url: "http://127.0.0.1:8080/login" }),
    ).toBe(false);
  });

  it("follows x-forwarded-proto from ngrok even if APP_URL differs", () => {
    expect(
      cookieSecureForRequest({
        forwardedProto: "https",
        url: "http://127.0.0.1:8080/login",
      }),
    ).toBe(true);
    expect(
      cookieSecureForRequest({
        forwardedProto: "http",
        url: "https://example.ngrok-free.app/login",
      }),
    ).toBe(false);
  });

  it("is true for direct HTTPS", () => {
    expect(
      cookieSecureForRequest({ url: "https://dina.example/login" }),
    ).toBe(true);
  });
});
