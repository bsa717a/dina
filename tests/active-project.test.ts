import { describe, expect, it } from "vitest";
import {
  getActiveProject,
  projectArgOrActive,
  projectNamesFromArgsOrActive,
  runWithActiveProject,
} from "@/lib/chat/active-project";
import { formatActiveProjectRuntime, getMemberSystemPrompt } from "@/lib/ai/prompt";

describe("active project context", () => {
  it("defaults tool args to the selected project and allows an override", () => {
    expect(() => projectArgOrActive({})).toThrow(/select a project/i);

    runWithActiveProject({ key: "dina", name: "Dina" }, () => {
      expect(getActiveProject()).toEqual({ key: "dina", name: "Dina" });
      expect(projectArgOrActive({})).toBe("dina");
      expect(projectArgOrActive({ project: " Beacon " })).toBe("Beacon");
      expect(projectNamesFromArgsOrActive({})).toEqual(["Dina"]);
      expect(projectNamesFromArgsOrActive({ projects: ["Regi"] })).toEqual([
        "Regi",
      ]);
    });

    expect(getActiveProject()).toBeNull();
  });

  it("tells the model to keep project work on the selected project", () => {
    const runtime = formatActiveProjectRuntime({ key: "dina", name: "Dina" });
    expect(runtime).toContain("Active project: Dina");
    expect(runtime).toContain("default to this project");
    expect(formatActiveProjectRuntime(null)).toBe("");

    const member = getMemberSystemPrompt({
      userName: "Alex",
      assistantName: "Nova",
      assistantPersona: "",
      projectNames: ["Dina", "Beacon"],
      activeProject: { key: "dina", name: "Dina" },
    });
    expect(member).toContain("Assigned projects: Dina, Beacon");
    expect(member).toContain("Active project: Dina");
  });
});
