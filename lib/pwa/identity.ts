import { DINA_PROFILE, getAssistantProfile } from "@/lib/assistants/catalog";

const DINA_ICON_VERSION = "3";
const ASSISTANT_ICON_VERSION = "1";

export type PwaIdentity = {
  key: string;
  name: string;
  description: string;
  icon192: string;
  icon512: string;
  icon512Maskable: string;
  appleTouchIcon: string;
  manifestUrl: string;
};

export type WebAppManifest = {
  name: string;
  short_name: string;
  description: string;
  start_url: string;
  scope: string;
  id: string;
  display: "standalone";
  display_override: string[];
  background_color: string;
  theme_color: string;
  icons: Array<{
    src: string;
    sizes: string;
    type: string;
    purpose: "any" | "maskable";
  }>;
};

function iconDir(key: string) {
  return key === "dina" ? "/icons" : `/icons/${key}`;
}

function iconVersion(key: string) {
  return key === "dina" ? DINA_ICON_VERSION : ASSISTANT_ICON_VERSION;
}

export function pwaIdentityForKey(key: string | null | undefined): PwaIdentity {
  const profile = getAssistantProfile(key) ?? DINA_PROFILE;
  const version = iconVersion(profile.key);
  const dir = iconDir(profile.key);
  return {
    key: profile.key,
    name: profile.name,
    description:
      profile.key === "dina"
        ? "Derek’s calm, capable chief of staff"
        : profile.title || profile.about,
    icon192: `${dir}/icon-192.png?v=${version}`,
    icon512: `${dir}/icon-512.png?v=${version}`,
    icon512Maskable: `${dir}/icon-512-maskable.png?v=${version}`,
    appleTouchIcon: `${dir}/apple-touch-icon.png?v=${version}`,
    manifestUrl: `/manifest.webmanifest?assistant=${encodeURIComponent(profile.key)}`,
  };
}

export function resolvePwaIdentity(input: {
  assistantKey?: string | null;
  fallbackKey?: string | null;
}): PwaIdentity {
  if (getAssistantProfile(input.assistantKey)) {
    return pwaIdentityForKey(input.assistantKey);
  }
  if (getAssistantProfile(input.fallbackKey)) {
    return pwaIdentityForKey(input.fallbackKey);
  }
  return pwaIdentityForKey("dina");
}

export function webAppManifest(identity: PwaIdentity): WebAppManifest {
  return {
    name: identity.name,
    short_name: identity.name,
    description: identity.description,
    start_url: "/",
    scope: "/",
    id: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    background_color: "#f7f7f5",
    theme_color: "#2f5d50",
    icons: [
      {
        src: identity.icon192,
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: identity.icon512,
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: identity.icon512Maskable,
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}

function upsertLink(
  rel: string,
  href: string,
  attrs: Record<string, string> = {},
) {
  const selector = Object.entries(attrs)
    .map(([key, value]) => `[${key}="${value}"]`)
    .join("");
  let link = document.head.querySelector<HTMLLinkElement>(
    `link[rel="${rel}"]${selector}`,
  );
  if (!link) {
    link = document.createElement("link");
    link.rel = rel;
    for (const [key, value] of Object.entries(attrs)) {
      link.setAttribute(key, value);
    }
    document.head.appendChild(link);
  }
  link.href = href;
}

function upsertMeta(name: string, content: string) {
  let meta = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = name;
    document.head.appendChild(meta);
  }
  meta.content = content;
}

/** Point Safari / Chrome install metadata at the signed-in assistant. */
export function applyPwaIdentity(identity: PwaIdentity) {
  if (typeof document === "undefined") return;
  document.title = identity.name;
  upsertMeta("apple-mobile-web-app-title", identity.name);
  upsertMeta("application-name", identity.name);
  upsertLink("manifest", identity.manifestUrl);
  upsertLink("apple-touch-icon", identity.appleTouchIcon, {
    sizes: "180x180",
  });
  upsertLink("icon", identity.icon192, {
    sizes: "192x192",
    type: "image/png",
  });
  upsertLink("icon", identity.icon512, {
    sizes: "512x512",
    type: "image/png",
  });
}
