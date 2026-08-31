import { afterEach, describe, expect, it } from "vitest";
import { runWithAuthUser } from "@/lib/auth/context";
import type { AuthUser } from "@/lib/auth/types";
import { prisma } from "@/lib/db/client";
import {
  archiveProject,
  createProject,
  ensureProjectCatalog,
  invalidateProjectCatalog,
  resolveProjectKey,
} from "@/lib/projects/catalog";
import { executeTeamTool } from "@/lib/team/tools";

const STAMP = Date.now().toString(36);

afterEach(async () => {
  await prisma.project.deleteMany({
    where: { key: { startsWith: `test_${STAMP}` } },
  });
  invalidateProjectCatalog();
});

describe("project catalog", () => {
  it("resolves seeded names without a DB hit after cache warmup", async () => {
    await ensureProjectCatalog();
    expect(resolveProjectKey("Dina")).toBe("dina");
    expect(resolveProjectKey("four student lives")).toBe("4studentlives");
    expect(resolveProjectKey("Reggie")).toBe("regi");
    expect(resolveProjectKey("not-a-real-project")).toBeNull();
  });

  it("creates and archives a project so it can be granted later", async () => {
    const created = await createProject({
      name: `Test ${STAMP}`,
      key: `test_${STAMP}_alpha`,
      aliases: ["alpha lab"],
    });
    expect(created.key).toBe(`test_${STAMP}_alpha`);
    expect(resolveProjectKey("alpha lab")).toBe(`test_${STAMP}_alpha`);

    const archived = await archiveProject("alpha lab");
    expect(archived.archived).toBe(true);
    expect(resolveProjectKey("alpha lab")).toBeNull();
  });
});

describe("create_project tool", () => {
  it("lets the owner register a project", async () => {
    const ownerRow = await prisma.user.findFirst({ where: { role: "owner" } });
    if (!ownerRow) throw new Error("Owner must be seeded.");
    const owner: AuthUser = {
      id: ownerRow.id,
      name: ownerRow.name,
      username: ownerRow.username,
      role: "owner",
      assistantName: ownerRow.assistantName,
      assistantPersona: ownerRow.assistantPersona,
      assistantKey: ownerRow.assistantKey,
      mustChangePassword: ownerRow.mustChangePassword,
      phoneNumber: ownerRow.phoneNumber ?? null,
    };

    const result = JSON.parse(
      await runWithAuthUser(owner, () =>
        executeTeamTool(
          "create_project",
          JSON.stringify({
            name: `Harbor ${STAMP}`,
            key: `test_${STAMP}_harbor`,
            aliases: ["harbor app"],
          }),
        ),
      ),
    );
    expect(result.ok).toBe(true);
    expect(result.data.project.key).toBe(`test_${STAMP}_harbor`);
    expect(resolveProjectKey("harbor app")).toBe(`test_${STAMP}_harbor`);
  });
});
