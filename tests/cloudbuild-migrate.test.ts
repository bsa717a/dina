import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relative: string): string {
  return readFileSync(path.join(root, relative), "utf8");
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
