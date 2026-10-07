import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({
  requireSession: vi.fn(async () => ({
    id: "user-derek",
    name: "Derek",
    username: "derek",
    role: "owner",
    assistantName: "Dina",
    assistantPersona: "",
    assistantKey: "dina",
    mustChangePassword: false,
  })),
}));

vi.mock("@/lib/db/client", () => ({
  checkDatabase: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/lib/project-tasks/membership", () => ({
  userCanAccessProject: vi.fn(async (_user: unknown, project: string) =>
    project === "4studentlives" || project === "4StudentLives"
      ? "4studentlives"
      : null,
  ),
}));

const listProjectSections = vi.fn(async () => [
  {
    id: "sec-sales",
    projectKey: "4studentlives",
    name: "Sales",
    sortOrder: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
]);
const addProjectSection = vi.fn(async () => ({
  id: "sec-sales",
  projectKey: "4studentlives",
  name: "Sales",
  sortOrder: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
}));
const requireProjectSectionById = vi.fn(async () => ({
  id: "sec-sales",
  projectKey: "4studentlives",
  name: "Sales",
  sortOrder: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
}));

vi.mock("@/lib/project-tasks/sections", () => ({
  listProjectSections,
  addProjectSection,
  requireProjectSectionById,
  requireProjectSection: requireProjectSectionById,
}));

const listProjectTasks = vi.fn(async () => [
  {
    id: "t1",
    number: 1,
    title: "Call the district",
    status: "open",
    sectionId: "sec-sales",
    sectionName: "Sales",
  },
]);
const addProjectTask = vi.fn(async () => ({
  id: "t1",
  projectKey: "4studentlives",
  title: "Call the district",
  description: "",
  status: "open",
  sortOrder: 1,
  source: "ui",
  createdByUserId: "user-derek",
  assigneeUserId: null,
  sectionId: "sec-sales",
  sectionName: "Sales",
  completedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}));
const updateProjectTask = vi.fn(async () => ({
  id: "t2",
  projectKey: "4studentlives",
  title: "Update the site",
  description: "",
  status: "open",
  sortOrder: 2,
  source: "ui",
  createdByUserId: null,
  assigneeUserId: null,
  sectionId: "sec-sales",
  sectionName: "Sales",
  completedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}));
const resolveProjectTask = vi.fn(async () => ({
  id: "t2",
  projectKey: "4studentlives",
  title: "Update the site",
  description: "",
  status: "open",
  sortOrder: 2,
  source: "ui",
  createdByUserId: null,
  assigneeUserId: null,
  sectionId: null,
  sectionName: null,
  completedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  number: 2,
}));

const remainingTaskNumber = vi.fn(async () => 1);
const completeProjectTask = vi.fn(async () => ({
  id: "t1",
  projectKey: "4studentlives",
  title: "Call the district",
  description: "",
  status: "done",
  sortOrder: 1,
  source: "ui",
  createdByUserId: "user-derek",
  assigneeUserId: null,
  sectionId: "sec-sales",
  sectionName: "Sales",
  completedAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
  number: 1,
}));

vi.mock("@/lib/project-tasks/store", () => ({
  listProjectTasks,
  addProjectTask,
  updateProjectTask,
  resolveProjectTask,
  remainingTaskNumber,
  completeProjectTask,
}));

describe("project sections API", () => {
  beforeEach(() => {
    listProjectSections.mockClear();
    addProjectSection.mockClear();
    addProjectTask.mockClear();
    updateProjectTask.mockClear();
    resolveProjectTask.mockClear();
    completeProjectTask.mockClear();
  });

  it("lists sections and tasks for a project", async () => {
    const { GET } = await import("@/app/api/project-sections/route");
    const res = await GET(
      new Request("http://localhost:8080/api/project-sections?project=4StudentLives"),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.project).toEqual({ key: "4studentlives", name: "4StudentLives" });
    expect(data.sections).toEqual([
      { id: "sec-sales", name: "Sales", sortOrder: 1 },
    ]);
    expect(data.tasks[0].title).toBe("Call the district");
    expect(data.tasks[0].sectionName).toBe("Sales");
  });

  it("adds a section", async () => {
    const { POST } = await import("@/app/api/project-sections/route");
    const res = await POST(
      new Request("http://localhost:8080/api/project-sections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: "4studentlives", name: "sales" }),
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.section.name).toBe("Sales");
    expect(addProjectSection).toHaveBeenCalledWith({
      project: "4studentlives",
      name: "sales",
    });
  });

  it("adds a task into a section", async () => {
    const { POST } = await import("@/app/api/project-sections/route");
    const res = await POST(
      new Request("http://localhost:8080/api/project-sections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project: "4studentlives",
          title: "Call the district",
          sectionId: "sec-sales",
        }),
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.task.sectionName).toBe("Sales");
    expect(addProjectTask).toHaveBeenCalledWith(
      expect.objectContaining({
        project: "4studentlives",
        title: "Call the district",
        sectionId: "sec-sales",
        source: "ui",
      }),
    );
  });

  it("moves a task into a section", async () => {
    const { PATCH } = await import("@/app/api/project-sections/route");
    const res = await PATCH(
      new Request("http://localhost:8080/api/project-sections", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project: "4studentlives",
          number: 2,
          sectionId: "sec-sales",
        }),
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.task.sectionName).toBe("Sales");
    expect(data.task.number).toBe(1);
    expect(updateProjectTask).toHaveBeenCalledWith("t2", {
      sectionId: "sec-sales",
    });
  });

  it("completes a task through the existing complete path", async () => {
    resolveProjectTask.mockResolvedValueOnce({
      id: "t1",
      projectKey: "4studentlives",
      title: "Call the district",
      description: "",
      status: "open",
      sortOrder: 1,
      source: "ui",
      createdByUserId: "user-derek",
      assigneeUserId: null,
      sectionId: "sec-sales",
      sectionName: "Sales",
      completedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      number: 1,
    } as never);
    const { PATCH } = await import("@/app/api/project-sections/route");
    const res = await PATCH(
      new Request("http://localhost:8080/api/project-sections", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project: "4studentlives",
          taskId: "t1",
          complete: true,
        }),
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.task.status).toBe("done");
    expect(data.task.assigneeUserId).toBeNull();
    expect(completeProjectTask).toHaveBeenCalledWith({ taskId: "t1" });
    expect(updateProjectTask).not.toHaveBeenCalled();
  });

  it("does not complete a task from another project", async () => {
    resolveProjectTask.mockResolvedValueOnce({
      id: "foreign",
      projectKey: "other",
      title: "Elsewhere",
      description: "",
      status: "open",
      sortOrder: 1,
      source: "ui",
      createdByUserId: null,
      assigneeUserId: null,
      sectionId: null,
      sectionName: null,
      completedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      number: 1,
    });
    const { PATCH } = await import("@/app/api/project-sections/route");
    const res = await PATCH(
      new Request("http://localhost:8080/api/project-sections", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project: "4studentlives",
          taskId: "foreign",
          complete: true,
        }),
      }),
    );
    expect(res.status).toBe(400);
    expect(completeProjectTask).not.toHaveBeenCalled();
  });

  it("rejects an unknown project", async () => {
    const { GET } = await import("@/app/api/project-sections/route");
    const res = await GET(
      new Request("http://localhost:8080/api/project-sections?project=nope"),
    );
    expect(res.status).toBe(400);
  });
});
