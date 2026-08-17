export type InstallPlatform = "ios" | "android" | "mac" | "other";

export type AddToHomepageResult =
  | { kind: "prompted"; outcome: "accepted" | "dismissed" }
  | { kind: "help"; platform: InstallPlatform }
  | { kind: "installed" };

export type InstallPath =
  | "installed"
  | "deferredPrompt"
  | "navigatorInstall"
  | "help";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

type InstallStateListener = () => void;

type NavigatorWithInstall = Navigator & {
  standalone?: boolean;
  install?: (...args: unknown[]) => Promise<unknown>;
};

declare global {
  interface Window {
    __dinaDeferredInstall?: BeforeInstallPromptEvent | null;
  }
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let watching = false;
const listeners = new Set<InstallStateListener>();

function notifyInstallState() {
  for (const listener of listeners) listener();
}

function adoptDeferredPrompt(event: BeforeInstallPromptEvent | null | undefined) {
  if (!event) return;
  deferredPrompt = event;
  if (typeof window !== "undefined") {
    window.__dinaDeferredInstall = event;
  }
}

export function detectInstallPlatform(input: {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
}): InstallPlatform {
  const ua = input.userAgent.toLowerCase();
  const iPadOsDesktopUa =
    /macintosh/.test(ua) && (input.maxTouchPoints ?? 0) > 1;
  if (/iphone|ipad|ipod/.test(ua) || iPadOsDesktopUa) return "ios";
  if (/android/.test(ua)) return "android";
  if (/mac os x|macintosh/.test(ua) || input.platform === "MacIntel") {
    return "mac";
  }
  return "other";
}

export function isStandaloneDisplay(input: {
  standaloneMedia: boolean;
  fullscreenMedia?: boolean;
  minimalUiMedia?: boolean;
  windowControlsOverlay?: boolean;
  iosStandalone?: boolean;
}): boolean {
  return (
    input.standaloneMedia ||
    Boolean(input.fullscreenMedia) ||
    Boolean(input.minimalUiMedia) ||
    Boolean(input.windowControlsOverlay) ||
    Boolean(input.iosStandalone)
  );
}

export function chooseInstallPath(input: {
  standalone: boolean;
  hasDeferredPrompt: boolean;
  hasNavigatorInstall: boolean;
}): InstallPath {
  if (input.standalone) return "installed";
  if (input.hasDeferredPrompt) return "deferredPrompt";
  if (input.hasNavigatorInstall) return "navigatorInstall";
  return "help";
}

export function homepageInstallHelp(platform: InstallPlatform): {
  title: string;
  steps: string[];
} {
  if (platform === "ios") {
    return {
      title: "Add Dina to your Home Screen",
      steps: [
        "Tap the Share button in Safari (the square with the arrow).",
        "Scroll down and tap Add to Home Screen.",
        "Tap Add. Dina will appear on your Home Screen like an app.",
      ],
    };
  }
  if (platform === "mac") {
    return {
      title: "Add Dina to the Dock",
      steps: [
        "In Safari, choose File → Add to Dock, or click Share in the toolbar and choose Add to Dock.",
        "In Chrome, click the install icon on the right side of the address bar, then Install.",
        "Dina opens in its own window and stays in the Dock.",
      ],
    };
  }
  if (platform === "android") {
    return {
      title: "Add Dina to your Home Screen",
      steps: [
        "Open the browser menu (the three dots).",
        "Tap Add to Home screen or Install app.",
        "Confirm Add. Dina will appear on your Home Screen like an app.",
      ],
    };
  }
  return {
    title: "Add Dina to your Home Screen",
    steps: [
      "Open your browser menu.",
      "Choose Install, Add to Home screen, or Add to Dock.",
      "Confirm. Dina will open as its own app.",
    ],
  };
}

export function currentInstallPlatform(): InstallPlatform {
  if (typeof window === "undefined") return "other";
  return detectInstallPlatform({
    userAgent: window.navigator.userAgent,
    platform: window.navigator.platform,
    maxTouchPoints: window.navigator.maxTouchPoints,
  });
}

export function isStandalonePwa(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as NavigatorWithInstall;
  return isStandaloneDisplay({
    standaloneMedia: window.matchMedia("(display-mode: standalone)").matches,
    fullscreenMedia: window.matchMedia("(display-mode: fullscreen)").matches,
    minimalUiMedia: window.matchMedia("(display-mode: minimal-ui)").matches,
    windowControlsOverlay: window.matchMedia(
      "(display-mode: window-controls-overlay)",
    ).matches,
    iosStandalone: nav.standalone === true,
  });
}

export function hasDeferredInstallPrompt() {
  if (deferredPrompt) return true;
  if (typeof window !== "undefined" && window.__dinaDeferredInstall) {
    adoptDeferredPrompt(window.__dinaDeferredInstall);
    return true;
  }
  return false;
}

export function subscribeInstallState(listener: InstallStateListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function watchInstallPrompt() {
  if (typeof window === "undefined") return;
  adoptDeferredPrompt(window.__dinaDeferredInstall);
  if (watching) return;
  watching = true;

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    adoptDeferredPrompt(event as BeforeInstallPromptEvent);
    notifyInstallState();
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    window.__dinaDeferredInstall = null;
    notifyInstallState();
  });
}

async function promptWithDeferredEvent(): Promise<AddToHomepageResult | null> {
  const promptEvent = deferredPrompt || window.__dinaDeferredInstall || null;
  if (!promptEvent) return null;
  try {
    await promptEvent.prompt();
    const { outcome } = await promptEvent.userChoice;
    deferredPrompt = null;
    window.__dinaDeferredInstall = null;
    notifyInstallState();
    return { kind: "prompted", outcome };
  } catch {
    deferredPrompt = null;
    window.__dinaDeferredInstall = null;
    notifyInstallState();
    return null;
  }
}

async function promptWithNavigatorInstall(): Promise<AddToHomepageResult | null> {
  const nav = window.navigator as NavigatorWithInstall;
  if (typeof nav.install !== "function") return null;
  try {
    await nav.install();
    notifyInstallState();
    return { kind: "prompted", outcome: "accepted" };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { kind: "prompted", outcome: "dismissed" };
    }
    try {
      await nav.install({
        manifest: "/manifest.webmanifest",
        manifestId: "/",
      });
      notifyInstallState();
      return { kind: "prompted", outcome: "accepted" };
    } catch (retryError) {
      if (retryError instanceof DOMException && retryError.name === "AbortError") {
        return { kind: "prompted", outcome: "dismissed" };
      }
      return null;
    }
  }
}

export async function promptAddToHomepage(): Promise<AddToHomepageResult> {
  watchInstallPrompt();
  const platform = currentInstallPlatform();
  const path = chooseInstallPath({
    standalone: isStandalonePwa(),
    hasDeferredPrompt: hasDeferredInstallPrompt(),
    hasNavigatorInstall:
      typeof (window.navigator as NavigatorWithInstall).install === "function",
  });

  if (path === "installed") return { kind: "installed" };

  if (path === "deferredPrompt") {
    const prompted = await promptWithDeferredEvent();
    if (prompted) return prompted;
    const installed = await promptWithNavigatorInstall();
    if (installed) return installed;
  }

  if (path === "navigatorInstall") {
    const installed = await promptWithNavigatorInstall();
    if (installed) return installed;
  }

  return { kind: "help", platform };
}
