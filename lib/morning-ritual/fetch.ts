/** Strip tags / collapse whitespace for LLM context. */
export function htmlToText(html: string, maxChars = 40_000): string {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  if (text.length > maxChars) text = `${text.slice(0, maxChars)}\n…[truncated]`;
  return text;
}

const CHURCH_HOSTS = new Set([
  "www.churchofjesuschrist.org",
  "churchofjesuschrist.org",
]);

export function isChurchUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      (u.protocol === "https:" || u.protocol === "http:") &&
      CHURCH_HOSTS.has(u.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}

export function isHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export type FetchResult = {
  ok: boolean;
  url: string;
  status?: number;
  text?: string;
  error?: string;
};

export async function fetchUrlText(
  url: string,
  options?: { requireChurch?: boolean; maxChars?: number; timeoutMs?: number },
): Promise<FetchResult> {
  if (!isHttpUrl(url)) {
    return { ok: false, url, error: "Invalid URL." };
  }
  if (options?.requireChurch && !isChurchUrl(url)) {
    return { ok: false, url, error: "URL not on churchofjesuschrist.org allowlist." };
  }

  const timeoutMs = options?.timeoutMs ?? 20_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "DinaMorningRitual/1.0 (+local; personal assistant)",
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
    });
    if (!res.ok) {
      return { ok: false, url, status: res.status, error: `HTTP ${res.status}` };
    }
    const html = await res.text();
    return {
      ok: true,
      url: res.url || url,
      status: res.status,
      text: htmlToText(html, options?.maxChars ?? 40_000),
    };
  } catch (error) {
    return {
      ok: false,
      url,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}
