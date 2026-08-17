import { describe, expect, it } from "vitest";
import {
  chooseInstallPath,
  detectInstallPlatform,
  homepageInstallHelp,
  isStandaloneDisplay,
} from "@/lib/client/pwa-install";

describe("detectInstallPlatform", () => {
  it("detects iPhone and iPad", () => {
    expect(
      detectInstallPlatform({
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
      }),
    ).toBe("ios");
    expect(
      detectInstallPlatform({
        userAgent:
          "Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15",
      }),
    ).toBe("ios");
  });

  it("treats iPadOS desktop UA with touch as iOS", () => {
    expect(
      detectInstallPlatform({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
        platform: "MacIntel",
        maxTouchPoints: 5,
      }),
    ).toBe("ios");
  });

  it("detects Android and Mac", () => {
    expect(
      detectInstallPlatform({
        userAgent:
          "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36",
      }),
    ).toBe("android");
    expect(
      detectInstallPlatform({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36",
        platform: "MacIntel",
        maxTouchPoints: 0,
      }),
    ).toBe("mac");
  });
});

describe("isStandaloneDisplay", () => {
  it("is true for installed display modes", () => {
    expect(isStandaloneDisplay({ standaloneMedia: true })).toBe(true);
    expect(
      isStandaloneDisplay({ standaloneMedia: false, iosStandalone: true }),
    ).toBe(true);
    expect(
      isStandaloneDisplay({
        standaloneMedia: false,
        windowControlsOverlay: true,
      }),
    ).toBe(true);
  });

  it("is false in a regular browser tab", () => {
    expect(isStandaloneDisplay({ standaloneMedia: false })).toBe(false);
  });
});

describe("homepageInstallHelp", () => {
  it("tells iPhone users to add to the Home Screen", () => {
    const help = homepageInstallHelp("ios");
    expect(help.title).toMatch(/Home Screen/);
    expect(help.steps.join(" ")).toMatch(/Add to Home Screen/);
  });

  it("tells Mac users to add to the Dock", () => {
    const help = homepageInstallHelp("mac");
    expect(help.title).toMatch(/Dock/);
    expect(help.steps.join(" ")).toMatch(/Add to Dock/);
  });
});

describe("chooseInstallPath", () => {
  it("uses the native Chrome prompt when the browser offered one", () => {
    expect(
      chooseInstallPath({
        standalone: false,
        hasDeferredPrompt: true,
        hasNavigatorInstall: false,
      }),
    ).toBe("deferredPrompt");
  });

  it("falls back to help when the browser cannot install", () => {
    expect(
      chooseInstallPath({
        standalone: false,
        hasDeferredPrompt: false,
        hasNavigatorInstall: false,
      }),
    ).toBe("help");
  });
});
