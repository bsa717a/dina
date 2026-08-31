import { afterEach, describe, expect, it } from "vitest";
import { runWithAuthUser } from "@/lib/auth/context";
import type { AuthUser } from "@/lib/auth/types";
import { prisma } from "@/lib/db/client";
import {
  formatStandingInstructionHelpMessage,
  formatStandingInstructionSavedMessage,
  formatStandingInstructionsRuntime,
  isStandingInstructionChatContent,
  STANDING_INSTRUCTION_PHRASES,
} from "@/lib/standing-instructions/format";
import { parseStandingInstructionRequest } from "@/lib/standing-instructions/parse";
import {
  resetStandingInstructionSeedGate,
  seedStandingInstructions,
} from "@/lib/standing-instructions/seed";
import {
  archiveStandingInstruction,
  listActiveStandingInstructions,
  setStandingInstruction,
} from "@/lib/standing-instructions/store";
import { executeStandingInstructionTool } from "@/lib/standing-instructions/tools";
import { MAX_ACTIVE_STANDING_INSTRUCTIONS } from "@/lib/standing-instructions/types";

afterEach(async () => {
  await prisma.standingInstruction.deleteMany({
    where: { source: "test" },
  });
});

async function ownerUser(): Promise<AuthUser> {
  const ownerRow = await prisma.user.findFirst({ where: { role: "owner" } });
  if (!ownerRow) throw new Error("Owner must be seeded for standing instruction tests.");
  return {
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
}

describe("standing instruction chat phrases", () => {
  it("parses set, list, and archive without treating casual chat as a rule", () => {
    expect(
      parseStandingInstructionRequest(
        "Standing instruction: never show calendar IDs",
      ),
    ).toEqual({
      kind: "set",
      title: "Never show calendar IDs",
      content: "never show calendar IDs",
    });
    expect(
      parseStandingInstructionRequest("From now on: lead with the recommendation"),
    ).toEqual({
      kind: "set",
      title: "Lead with the recommendation",
      content: "lead with the recommendation",
    });
    expect(parseStandingInstructionRequest("Show standing instructions")).toEqual({
      kind: "list",
    });
    expect(
      parseStandingInstructionRequest(
        "Forget standing instruction: Never show task IDs",
      ),
    ).toEqual({ kind: "archive", title: "Never show task IDs" });
    expect(
      parseStandingInstructionRequest("How can I get you to remember this"),
    ).toEqual({ kind: "help" });
    expect(
      parseStandingInstructionRequest("how do I make this stick?"),
    ).toEqual({ kind: "help" });
    expect(
      parseStandingInstructionRequest(
        "How can I get you to remember this for the Utah trip",
      ),
    ).toBeNull();
    expect(parseStandingInstructionRequest("From now on I'll be in Utah")).toBeNull();
    expect(parseStandingInstructionRequest("add a task")).toBeNull();
  });

  it("shows the four standing-instruction phrases for how-to questions", () => {
    const help = formatStandingInstructionHelpMessage();
    for (const phrase of STANDING_INSTRUCTION_PHRASES) {
      expect(help).toContain(phrase);
    }
    expect(
      isStandingInstructionChatContent(
        "user",
        "How can I get you to remember this",
      ),
    ).toBe(true);
    expect(isStandingInstructionChatContent("assistant", help)).toBe(true);
  });

  it("formats a save receipt and recognizes leftover standing-instruction chat", () => {
    const saved = formatStandingInstructionSavedMessage({
      title: "Never show calendar IDs",
      content: "Never show calendar IDs",
    });
    expect(saved).toContain("Standing instruction saved");
    expect(saved).toContain("not Memory");
    expect(
      isStandingInstructionChatContent(
        "user",
        "Standing instruction: never show calendar IDs",
      ),
    ).toBe(true);
    expect(isStandingInstructionChatContent("assistant", saved)).toBe(true);
    expect(isStandingInstructionChatContent("user", "add a task")).toBe(false);
    expect(
      isStandingInstructionChatContent("user", "From now on I'll be in Utah"),
    ).toBe(false);
    expect(
      isStandingInstructionChatContent("user", "How can I add a task to Beacon"),
    ).toBe(false);
  });
});

describe("standing instructions", () => {
  it("upserts by title and injects titles only into session runtime", async () => {
    const first = await setStandingInstruction({
      title: "Lead with the recommendation",
      content: "Start with the recommendation, then the why.",
      source: "test",
    });
    const second = await setStandingInstruction({
      title: "Lead with the recommendation",
      content: "Start with one recommendation. Mention tradeoffs after.",
      source: "test",
    });
    expect(second.id).toBe(first.id);
    expect(second.content).toMatch(/tradeoffs/);

    const runtime = formatStandingInstructionsRuntime([second]);
    expect(runtime).toContain("STANDING INSTRUCTIONS");
    expect(runtime).toContain("Lead with the recommendation");
    expect(runtime).toContain("Start with one recommendation");
    expect(runtime).not.toContain(second.id);
    expect(formatStandingInstructionsRuntime([])).toContain("(none yet)");
  });

  it("seeds Never show task IDs once and does not duplicate", async () => {
    resetStandingInstructionSeedGate();
    await seedStandingInstructions();
    const first = await prisma.standingInstruction.findUnique({
      where: { title: "Never show task IDs" },
    });
    expect(first).toBeTruthy();

    resetStandingInstructionSeedGate();
    const created = await seedStandingInstructions();
    expect(created).toBe(0);
    const again = await prisma.standingInstruction.findUnique({
      where: { title: "Never show task IDs" },
    });
    expect(again?.id).toBe(first?.id);
    expect(again?.content).toBe(first?.content);
  });

  it("saves via owner tools without returning an id", async () => {
    const owner = await ownerUser();
    const saved = JSON.parse(
      await runWithAuthUser(owner, () =>
        executeStandingInstructionTool(
          "set_standing_instruction",
          JSON.stringify({
            title: "No recap",
            content: "Do not recap the question.",
          }),
        ),
      ),
    );
    expect(saved.ok).toBe(true);
    expect(saved.data.instruction.title).toBe("No recap");
    expect(saved.data.instruction.id).toBeUndefined();

    const listed = JSON.parse(
      await runWithAuthUser(owner, () =>
        executeStandingInstructionTool("list_standing_instructions", "{}"),
      ),
    );
    expect(listed.ok).toBe(true);
    expect(
      listed.data.instructions.some(
        (item: { title: string }) => item.title === "No recap",
      ),
    ).toBe(true);
    expect(listed.data.instructions[0].id).toBeUndefined();

    await prisma.standingInstruction.deleteMany({
      where: { title: "No recap" },
    });
  });

  it("enforces the active cap", async () => {
    const already = (await listActiveStandingInstructions()).length;
    const room = Math.max(0, MAX_ACTIVE_STANDING_INSTRUCTIONS - already);
    const created: string[] = [];
    let hitCap = false;
    for (let i = 0; i <= room; i += 1) {
      const title = `Cap test ${i}`;
      created.push(title);
      try {
        await setStandingInstruction({
          title,
          content: `Rule ${i}`,
          source: "test",
        });
      } catch (error) {
        hitCap = true;
        expect(i).toBe(room);
        expect(String(error)).toMatch(/At most/);
      }
    }
    expect(hitCap).toBe(true);
    const active = await listActiveStandingInstructions();
    expect(active.length).toBeLessThanOrEqual(MAX_ACTIVE_STANDING_INSTRUCTIONS);
    await prisma.standingInstruction.deleteMany({
      where: { title: { in: created } },
    });
  });

  it("does not reactivate an archived instruction when the cap is full", async () => {
    const parked = await setStandingInstruction({
      title: "Parked cap rule",
      content: "Parked",
      source: "test",
    });
    await archiveStandingInstruction(parked.title);

    const already = (await listActiveStandingInstructions()).length;
    const room = Math.max(0, MAX_ACTIVE_STANDING_INSTRUCTIONS - already);
    const created: string[] = [];
    for (let i = 0; i < room; i += 1) {
      const title = `Cap fill ${i}`;
      created.push(title);
      await setStandingInstruction({
        title,
        content: `Fill ${i}`,
        source: "test",
      });
    }

    await expect(
      setStandingInstruction({
        title: parked.title,
        content: "Should stay archived",
        source: "test",
      }),
    ).rejects.toThrow(/At most/);
    const parkedAgain = await prisma.standingInstruction.findUnique({
      where: { title: parked.title },
    });
    expect(parkedAgain?.status).toBe("archived");

    await prisma.standingInstruction.deleteMany({
      where: { title: { in: [...created, parked.title] } },
    });
  });
});
