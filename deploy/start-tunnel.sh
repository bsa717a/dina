#!/bin/bash
# Public tunnel for Dina (Cloudflare).
# Prefers a named tunnel (~/.cloudflared/config.yml) so the hostname stays stable.
# Otherwise uses a trycloudflare.com quick tunnel and rewrites APP_URL when the
# hostname changes (PWA / invite links still need a named tunnel to survive reboot).
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

CLOUDFLARED="/opt/homebrew/bin/cloudflared"
ENV_FILE="/Users/derekfowler/repo/dina/.env"
URL_FILE="${HOME}/Library/Logs/dina/tunnel-url.txt"
APP_LABEL="gui/$(id -u)/com.dina.app"

mkdir -p "$(dirname "$URL_FILE")"

sync_app_url() {
  local url="$1"
  printf '%s\n' "$url" > "$URL_FILE"

  if [[ ! -f "$ENV_FILE" ]] || ! grep -q '^APP_URL=' "$ENV_FILE"; then
    return 0
  fi

  local current
  current="$(grep '^APP_URL=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
  if [[ "$current" == "$url" ]]; then
    return 0
  fi

  local tmp
  tmp="$(mktemp)"
  awk -v url="$url" '
    BEGIN { done = 0 }
    /^APP_URL=/ && !done { print "APP_URL=" url; done = 1; next }
    { print }
  ' "$ENV_FILE" > "$tmp"
  mv "$tmp" "$ENV_FILE"
  echo "dina: APP_URL updated to ${url}"
  launchctl kickstart -k "$APP_LABEL" || true
}

if [[ -f "${HOME}/.cloudflared/config.yml" || -f "${HOME}/.cloudflared/config.yaml" ]]; then
  echo "dina: starting named Cloudflare tunnel"
  exec "$CLOUDFLARED" tunnel --no-autoupdate run
fi

echo "dina: starting Cloudflare quick tunnel"
set -o pipefail
"$CLOUDFLARED" tunnel --url http://127.0.0.1:8080 --no-autoupdate 2>&1 | while IFS= read -r line; do
  printf '%s\n' "$line"
  if [[ "$line" =~ https://[a-zA-Z0-9-]+\.trycloudflare\.com ]]; then
    sync_app_url "${BASH_REMATCH[0]}"
  fi
done
