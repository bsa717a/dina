export type InstallPlatform = "ios" | "android" | "mac" | "other";

export type AddToHomepageResult =
  | { kind: "prompted"; outcome: "accepted" | "dismissed" }
  | { kind: "help"; platform: InstallPlatform }
  | { kind: "installed" };

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

type InstallStateListener = () => void;

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let watching = false;
const listeners = new Set<InstallStateListener>();

function notifyInstallState() {
  for (const listener of listeners) listener();
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
  const nav = window.navigator as Navigator & { standalone?: boolean };
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
  return deferredPrompt !== null;
}

export function subscribeInstallState(listener: InstallStateListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function watchInstallPrompt() {
  if (typeof window === "undefined" || watching) return;
  watching = true;

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    notifyInstallState();
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    notifyInstallState();
  });
}

export async function promptAddToHomepage(): Promise<AddToHomepageResult> {
  if (isStandalonePwa()) return { kind: "installed" };

  if (deferredPrompt) {
    const promptEvent = deferredPrompt;
    try {
      await promptEvent.prompt();
      const { outcome } = await promptEvent.userChoice;
      deferredPrompt = null;
      notifyInstallState();
      return { kind: "prompted", outcome };
    } catch {
      deferredPrompt = null;
      notifyInstallState();
    }
  }

  return { kind: "help", platform: currentInstallPlatform() };
}
