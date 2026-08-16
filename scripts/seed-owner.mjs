import { createRequire } from "module";

const require = createRequire(import.meta.url);

async function main() {
  const { PrismaClient } = require("@prisma/client");
  const { scryptSync, randomBytes } = require("crypto");
  const prisma = new PrismaClient();
  const accessCode = process.env.ACCESS_CODE;
  if (!accessCode) {
    throw new Error("ACCESS_CODE is required to seed the owner password.");
  }

  const existing = await prisma.user.findFirst({ where: { role: "owner" } });
  if (existing) {
    console.log(`Owner already exists: ${existing.username} (${existing.id})`);
    await prisma.$disconnect();
    return;
  }

  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(accessCode, salt, 64).toString("hex");
  const user = await prisma.user.create({
    data: {
      name: "Derek",
      username: "derek",
      role: "owner",
      assistantName: "Dina",
      assistantPersona: "",
      assistantKey: "dina",
      passwordHash: `scrypt:${salt}:${hash}`,
      mustChangePassword: false,
    },
  });

  const keys = [
    "dina",
    "beacon",
    "4studentlives",
    "metabolicos",
    "hidden_guardians",
    "clifsmama",
  ];
  await prisma.projectMember.createMany({
    data: keys.map((projectKey) => ({
      userId: user.id,
      projectKey,
      role: "owner",
    })),
    skipDuplicates: true,
  });

  console.log(`Seeded owner ${user.username} (${user.id})`);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
