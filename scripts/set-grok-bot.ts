/**
 * Point a Piper user at their own Grok Bot and issue an API token.
 *
 * The token is printed once. Only its SHA-256 hash is stored.
 * The webhook secret is stored as AES-256-GCM ciphertext keyed by SESSION_SECRET.
 *
 *   USERNAME="adam" \
 *   GROK_WEBHOOK_URL="https://adam-bot.example/webhook" \
 *   GROK_WEBHOOK_SECRET="crsr_..." \
 *   npm run user:grok-bot
 */
import { prisma } from "@/lib/db/client";
import { issueUserGrokBotCredentials } from "@/lib/grok-api/bots";

async function main() {
  const username = process.env.USERNAME || "";
  const webhookUrl = process.env.GROK_WEBHOOK_URL || "";
  const webhookSecret = process.env.GROK_WEBHOOK_SECRET || "";

  const result = await issueUserGrokBotCredentials({
    username,
    webhookUrl,
    webhookSecret,
  });

  console.log(`Configured Grok bot for @${result.username}`);
  console.log(`Webhook: ${result.webhookUrl}`);
  console.log("API token (shown once, not stored):");
  console.log(result.token);
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Failed to configure Grok bot";
    console.error(message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
