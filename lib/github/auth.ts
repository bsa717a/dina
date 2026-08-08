import { createPrivateKey, createSign } from "node:crypto";
import type { GitHubAccountConfig } from "@/lib/github/types";

type CachedToken = { token: string; expiresAt: number };

const installationTokenCache = new Map<string, CachedToken>();

function base64url(input: Buffer | string) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

/** Create a short-lived GitHub App JWT (RS256). */
export function createGitHubAppJwt(appId: string, privateKeyPem: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iat: now - 60,
    exp: now + 9 * 60,
    iss: appId,
  };
  const encoded =
    `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const key = createPrivateKey(privateKeyPem);
  const signer = createSign("RSA-SHA256");
  signer.update(encoded);
  signer.end();
  const signature = signer.sign(key);
  return `${encoded}.${base64url(signature)}`;
}

async function fetchInstallationToken(
  account: GitHubAccountConfig,
): Promise<string> {
  if (!account.appId || !account.installationId || !account.appPrivateKey) {
    throw new Error(`GitHub App credentials incomplete for account ${account.id}`);
  }

  const cached = installationTokenCache.get(account.id);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }

  const jwt = createGitHubAppJwt(account.appId, account.appPrivateKey);
  const res = await fetch(
    `https://api.github.com/app/installations/${encodeURIComponent(account.installationId)}/access_tokens`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${jwt}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "dina-chief-of-staff",
      },
    },
  );

  const body = (await res.json().catch(() => ({}))) as {
    token?: string;
    expires_at?: string;
    message?: string;
  };

  if (!res.ok || !body.token) {
    throw new Error(
      body.message ||
        `GitHub App installation token failed for ${account.id} (${res.status})`,
    );
  }

  const expiresAt = body.expires_at
    ? Date.parse(body.expires_at)
    : Date.now() + 50 * 60_000;
  installationTokenCache.set(account.id, { token: body.token, expiresAt });
  return body.token;
}

export async function getAccountAccessToken(
  account: GitHubAccountConfig,
): Promise<string> {
  if (account.authMode === "token") {
    if (!account.token) {
      throw new Error(`GitHub token missing for account ${account.id}`);
    }
    return account.token;
  }
  return fetchInstallationToken(account);
}

/** Test helper to clear cached installation tokens. */
export function clearGitHubTokenCache() {
  installationTokenCache.clear();
}
