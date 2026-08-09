#!/usr/bin/env node
/**
 * One-time Google OAuth helper for Dina.
 * Prints an auth URL, then exchanges the code for a refresh token.
 *
 * Prerequisites:
 * 1. Google Cloud project → OAuth client (Desktop or Web)
 * 2. Enable Gmail API + Google Calendar API
 * 3. Consent screen in Production (Testing expires refresh tokens in 7 days)
 *
 * Usage:
 *   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... node scripts/google-oauth-setup.mjs
 *   # open the URL, approve, paste the redirect URL or code
 */

import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID?.trim();
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET?.trim();
const REDIRECT_URI =
  process.env.GOOGLE_REDIRECT_URI?.trim() || "http://127.0.0.1:8080/oauth2/callback";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the environment first.",
  );
  process.exit(1);
}

const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authUrl.searchParams.set("client_id", CLIENT_ID);
authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("scope", SCOPES);
authUrl.searchParams.set("access_type", "offline");
authUrl.searchParams.set("prompt", "consent");

console.log("\n1) Add this redirect URI to your OAuth client if needed:");
console.log(`   ${REDIRECT_URI}`);
console.log("\n2) Open this URL in a browser and approve access:\n");
console.log(authUrl.toString());
console.log(
  "\n3) After redirect, paste the full redirect URL (or just the code):\n",
);

const rl = readline.createInterface({ input, output });
const pasted = (await rl.question("> ")).trim();
rl.close();

let code = pasted;
try {
  if (pasted.includes("://")) {
    code = new URL(pasted).searchParams.get("code") || "";
  }
} catch {
  // keep as-is
}

if (!code) {
  console.error("No authorization code found.");
  process.exit(1);
}

const body = new URLSearchParams({
  code,
  client_id: CLIENT_ID,
  client_secret: CLIENT_SECRET,
  redirect_uri: REDIRECT_URI,
  grant_type: "authorization_code",
});

const response = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body,
});

const payload = await response.json();
if (!response.ok || !payload.refresh_token) {
  console.error("Token exchange failed:", payload);
  if (!payload.refresh_token && payload.access_token) {
    console.error(
      "\nGot access_token but no refresh_token. Revoke prior grants at",
      "https://myaccount.google.com/permissions and retry with prompt=consent.",
    );
  }
  process.exit(1);
}

console.log("\nSuccess. Add these to .env:\n");
console.log(`GOOGLE_CLIENT_ID=${CLIENT_ID}`);
console.log(`GOOGLE_CLIENT_SECRET=${CLIENT_SECRET}`);
console.log(`GOOGLE_REFRESH_TOKEN=${payload.refresh_token}`);
console.log("GOOGLE_USER_EMAIL=your@gmail.com");
console.log("# GOOGLE_LABEL=personal");
console.log(
  "\nReminder: put the OAuth consent screen in Production so the refresh token does not expire in 7 days.\n",
);
