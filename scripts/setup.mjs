import { mkdir, access, copyFile } from "fs/promises";
import { spawnSync } from "child_process";
import path from "path";

const root = process.cwd();

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

await mkdir(path.join(root, "data", "uploads"), { recursive: true });
await mkdir(path.join(root, "public", "icons"), { recursive: true });

const envPath = path.join(root, ".env");
const examplePath = path.join(root, ".env.example");
if (!(await exists(envPath)) && (await exists(examplePath))) {
  await copyFile(examplePath, envPath);
  console.log("Created .env from .env.example — fill in secrets before running.");
}

const icon192 = path.join(root, "public", "icons", "icon-192.png");
if (!(await exists(icon192))) {
  console.log("Generating app icons…");
  const iconResult = spawnSync("node", ["scripts/generate-icons.mjs"], {
    cwd: root,
    stdio: "inherit",
  });
  if (iconResult.status !== 0) process.exit(iconResult.status ?? 1);
}

console.log("Running prisma migrate…");
const migrate = spawnSync(
  "npx",
  ["prisma", "migrate", "deploy"],
  { cwd: root, stdio: "inherit", env: process.env },
);

if (migrate.status !== 0) {
  console.log("migrate deploy failed or no migrations yet; trying prisma db push…");
  const push = spawnSync("npx", ["prisma", "db", "push"], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  if (push.status !== 0) process.exit(push.status ?? 1);
}

const generate = spawnSync("npx", ["prisma", "generate"], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});
if (generate.status !== 0) process.exit(generate.status ?? 1);

console.log("\nSetup complete.");
console.log("Next:");
console.log("  1. Edit .env (ACCESS_CODE, SESSION_SECRET, OPENAI_API_KEY, APP_URL)");
console.log("  2. npm run generate-vapid  # then paste keys into .env");
console.log("  3. npm run dev");
