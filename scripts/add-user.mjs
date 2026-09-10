/**
 * Add a teammate. They set a password and pick a personality on first login.
 *
 *   NAME="Alex" USERNAME="alex" TEMP_PASSWORD="temporary-password" \
 *     PROJECTS="regi" SLACK_USER_ID="U012ABCDEF" npm run user:add
 */
import { createRequire } from "module";

const require = createRequire(import.meta.url);

const KNOWN = [
  "dina",
  "beacon",
  "4studentlives",
  "metabolicos",
  "hidden_guardians",
  "clifsmama",
  "regi",
];

function hashPassword(password) {
  const { scryptSync, randomBytes } = require("crypto");
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

async function main() {
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();

  const name = (process.env.NAME || "").trim();
  const username = (process.env.USERNAME || "").trim().toLowerCase();
  const password = (process.env.TEMP_PASSWORD || "").trim();
  const slackUserId = (process.env.SLACK_USER_ID || "").trim();
  const projects = (process.env.PROJECTS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  if (!name || !username || !password) {
    throw new Error("NAME, USERNAME, and TEMP_PASSWORD are required.");
  }
  if (!/^[a-z0-9_]{2,32}$/.test(username)) {
    throw new Error("USERNAME must be 2–32 letters, numbers, or underscores.");
  }
  if (password.length < 10) {
    throw new Error("TEMP_PASSWORD must be at least 10 characters.");
  }

  const keys = projects.filter((key) => KNOWN.includes(key));
  if (!keys.length) {
    throw new Error(`PROJECTS must include at least one of: ${KNOWN.join(", ")}`);
  }
  if (slackUserId && !/^U[A-Z0-9]+$/i.test(slackUserId)) {
    throw new Error("SLACK_USER_ID must look like U012ABCDEF.");
  }

  const user = await prisma.user.create({
    data: {
      name,
      username,
      role: "member",
      assistantName: "",
      assistantPersona: "",
      assistantKey: null,
      passwordHash: hashPassword(password),
      mustChangePassword: true,
      ...(slackUserId ? { slackUserId } : {}),
      memberships: {
        create: keys.map((projectKey) => ({
          projectKey,
          role: "member",
        })),
      },
    },
  });

  console.log(
    `Added ${user.name} @${user.username} (${user.id}) — they must set a password and pick a personality on first login. projects=${keys.join(",")}${slackUserId ? ` slack=${slackUserId}` : ""}`,
  );
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
