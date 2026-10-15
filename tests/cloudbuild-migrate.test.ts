import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relative: string): string {
  return readFileSync(path.join(root, relative), "utf8");
}

function migrateResult(status: string, line: string): number {
  try {
    execFileSync("bash", ["deploy/migrate-result.sh", status, line], {
      cwd: root,
      encoding: "utf8",
      stdio: "ignore",
    });
    return 0;
  } catch (error) {
    const failed = error as { status?: number };
    return failed.status ?? 1;
  }
}

function stepBody(config: string, id: string, nextId?: string): string {
  const start = config.indexOf(`id: ${id}`);
  if (start < 0) {
    throw new Error(`missing step ${id}`);
  }
  const rest = config.slice(start);
  if (!nextId) return rest;
  const end = rest.indexOf(`id: ${nextId}`);
  if (end < 0) {
    throw new Error(`missing step ${nextId} after ${id}`);
  }
  return rest.slice(0, end);
}

describe("Cloud Build prod migrate", () => {
  const config = read("cloudbuild.yaml");
  const migrate = read("deploy/run-prod-migrate.sh");
  const dockerfile = read("deploy/migrate.Dockerfile");
  const packageJson = read("package.json");

  it("runs the migrate job before the service revision is created", () => {
    const deployWait = config.match(/id: deploy[\s\S]*?waitFor: \[(.*?)\]/);
    expect(deployWait?.[1]).toContain('"push"');
    expect(deployWait?.[1]).toContain('"migrate"');
    expect(config).toMatch(/id: migrate[\s\S]*?waitFor: \["migrate-image"\]/);
    expect(config).toMatch(/id: traffic[\s\S]*?waitFor: \["deploy"\]/);
    expect(config).toContain("--no-traffic");
    expect(config).toContain(
      "--to-revisions=dina-${SHORT_SHA}-${BUILD_ID}=100",
    );
    expect(config).not.toContain("--to-latest");
  });

  it("leaves service env, secrets, and Cloud SQL bindings alone", () => {
    const deploy = config.split("id: deploy")[1]?.split("id: traffic")[0] ?? "";
    expect(deploy).not.toContain("--set-secrets");
    expect(deploy).not.toContain("--update-secrets");
    expect(deploy).not.toContain("--set-env-vars");
    expect(deploy).not.toContain("--set-cloudsql-instances");
    expect(deploy).toContain("--project=dina-pm");
  });

  it("migrates through the existing Cloud SQL socket and secret", () => {
    expect(migrate).toContain("dina-pm:us-central1:dina-pg");
    expect(migrate).toContain('SECRET="dina-database-url"');
    expect(migrate).toContain('DATABASE_URL=${SECRET}:latest');
    expect(migrate).toContain(
      "585818436276-compute@developer.gserviceaccount.com",
    );
    expect(migrate).toContain('JOB="dina-migrate"');
    expect(migrate).not.toContain("migrate dev");
    expect(dockerfile).toContain(
      'ENTRYPOINT ["/usr/local/bin/node", "/app/node_modules/prisma/build/index.js", "migrate", "deploy"]',
    );
    const prismaVersion = packageJson.match(/"prisma": "([^"]+)"/)?.[1];
    expect(prismaVersion).toBeTruthy();
    expect(dockerfile).toContain(`ARG PRISMA_VERSION=${prismaVersion}`);
  });

  it("passes _LINKED_REPO into every step that reads main", () => {
    const mapping = /env:\s*\n(?:\s+- "[^"]+"\n)*\s+- "_LINKED_REPO=\$_LINKED_REPO"/;
    const migrateStep = stepBody(config, "migrate", "deploy");
    const trafficStep = stepBody(config, "traffic");
    expect(migrateStep).toContain("deploy/run-prod-migrate.sh");
    expect(migrate).toContain("github-main-sha.sh");
    expect(trafficStep).toContain("deploy/github-main-sha.sh");
    expect(migrateStep).toMatch(mapping);
    expect(trafficStep).toMatch(mapping);
  });

  it("exports COMMIT_SHA and BUILD_ID into the scripts that read them", () => {
    expect(config).not.toMatch(/automapSubstitutions:\s*true/);
    const imageStep = stepBody(config, "migrate-image", "build");
    const migrateStep = stepBody(config, "migrate", "deploy");
    const trafficStep = stepBody(config, "traffic");
    expect(imageStep).toContain("deploy/build-migrate-image.sh");
    expect(imageStep).toContain('"COMMIT_SHA=$COMMIT_SHA"');
    expect(migrateStep).toContain('"COMMIT_SHA=$COMMIT_SHA"');
    expect(migrateStep).toContain('"BUILD_ID=$BUILD_ID"');
    expect(migrateStep).toContain('"_LINKED_REPO=$_LINKED_REPO"');
    expect(trafficStep).toContain('"_LINKED_REPO=$_LINKED_REPO"');
    expect(trafficStep).toContain('"$COMMIT_SHA"');
    expect(trafficStep).not.toContain('"COMMIT_SHA=$COMMIT_SHA"');
    expect(trafficStep).not.toContain('"BUILD_ID=$BUILD_ID"');
  });

  it("treats a blank failedCount as success when the job succeeded", () => {
    expect(migrate).toContain("deploy/migrate-result.sh");
    const line = "dina-migrate-abc\t1";
    expect(migrateResult("0", line)).toBe(0);
    expect(migrateResult("0", "dina-migrate-abc\t1\t0")).toBe(0);
    expect(migrateResult("1", line)).not.toBe(0);
    expect(migrateResult("0", "dina-migrate-abc\t0")).not.toBe(0);
    expect(migrateResult("0", "dina-migrate-abc\t1\t1")).not.toBe(0);
  });

  it("refuses to migrate outside Cloud Build", () => {
    const env = { ...process.env };
    delete env.BUILD_ID;
    delete env.COMMIT_SHA;
    let stderr = "";
    try {
      execFileSync("bash", ["deploy/run-prod-migrate.sh"], {
        cwd: root,
        env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      throw new Error("script exited 0");
    } catch (error) {
      const failed = error as { status?: number; stderr?: string };
      expect(failed.status).not.toBe(0);
      stderr = failed.stderr ?? "";
    }
    expect(stderr).toContain("Refusing to migrate outside Cloud Build.");
  });
});
