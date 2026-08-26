import { describe, expect, it } from "vitest";
import { getConstitution } from "@/lib/ai/constitution";
import { getDerekProfile } from "@/lib/ai/derek-profile";
import { getDerekProjects } from "@/lib/ai/derek-projects";
import { getDinaMemoryRules } from "@/lib/ai/dina-memory-rules";
import { getDinaOperatingManual } from "@/lib/ai/dina-operating-manual";
import { getDinaSystemPrompt } from "@/lib/ai/prompt";

describe("Dina foundational documents", () => {
  it("loads the foundational constitution document", () => {
    const text = getConstitution();
    expect(text).toMatch(/Dina Constitution/);
    expect(text).toMatch(/Chief of Staff/);
    expect(text).toMatch(/What should Derek know, and what should he do about it/);
    expect(text).toMatch(/Truth Over Agreement/);
    expect(text).toMatch(/Fabricated sources are a serious mistake/);
    expect(text).toMatch(/search_church_site/);
    expect(text).toMatch(/Hard evidence for Derek/);
  });

  it("loads the Dina operating manual", () => {
    const text = getDinaOperatingManual();
    expect(text).toMatch(/Dina Operating Manual/);
    expect(text).toMatch(/Decision Framework/);
    expect(text).toMatch(/Daily Briefing/);
    expect(text).toMatch(/May Always/);
    expect(text).toMatch(/Final Promise/);
  });

  it("loads the Derek Fowler profile", () => {
    const text = getDerekProfile();
    expect(text).toMatch(/Derek Fowler Profile/);
    expect(text).toMatch(/Core Values/);
    expect(text).toMatch(/Family is the highest earthly priority/);
    expect(text).toMatch(/Communication Preferences/);
  });

  it("loads Derek projects", () => {
    const text = getDerekProjects();
    expect(text).toMatch(/Derek Projects/);
    expect(text).toMatch(/Beacon/);
    expect(text).toMatch(/4StudentLives/);
    expect(text).toMatch(/primary unit of work/);
  });

  it("loads Dina memory rules", () => {
    const text = getDinaMemoryRules();
    expect(text).toMatch(/Dina Memory Rules/);
    expect(text).toMatch(/Will knowing this in six months/);
    expect(text).toMatch(/understood, not watched/);
    expect(text).toMatch(/Approval Required/);
    expect(text).toMatch(/standing instructions/);
  });

  it("places foundational docs ahead of runtime wiring", () => {
    const prompt = getDinaSystemPrompt();
    expect(prompt.startsWith("# Dina Constitution")).toBe(true);
    expect(prompt).toMatch(/Dina Operating Manual/);
    expect(prompt).toMatch(/Derek Fowler Profile/);
    expect(prompt).toMatch(/Derek Projects/);
    expect(prompt).toMatch(/Dina Memory Rules/);
    expect(prompt).toMatch(/Runtime capabilities/);
    expect(prompt).toMatch(/Chief of Staff Engine/);
    expect(prompt).toMatch(/Standing instructions/);
    expect(prompt).toMatch(/Never show task IDs/);
  });
});
