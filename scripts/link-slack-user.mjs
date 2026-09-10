/**
 * Link a Piper username to a Slack user id (Regi roster).
 *
 *   USERNAME="adam" SLACK_USER_ID="U012ABCDEF" npm run user:link-slack
 */
import { createRequire } from "module";

const require = createRequire(import.meta.url);

async function main() {
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();

  const username = (process.env.USERNAME || "").trim().toLowerCase();
  const slackUserId = (process.env.SLACK_USER_ID || "").trim();

  if (!username || !slackUserId) {
    throw new Error("USERNAME and SLACK_USER_ID are required.");
  }
  if (!/^U[A-Z0-9]+$/i.test(slackUserId)) {
    throw new Error("SLACK_USER_ID must look like U012ABCDEF.");
  }

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) {
    throw new Error(`No Piper user found for username "${username}".`);
  }

  const taken = await prisma.user.findUnique({ where: { slackUserId } });
  if (taken && taken.id !== user.id) {
    throw new Error(`Slack user ${slackUserId} is already linked to @${taken.username}.`);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { slackUserId },
  });

  console.log(`Linked @${username} → Slack ${slackUserId}`);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
