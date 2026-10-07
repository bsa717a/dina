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

const listAssignableUsers = vi.fn(async (projectKey: string) => {
  void projectKey;
  return [
    { id: "user-derek", name: "Derek" },
    { id: "user-adam", name: "Adam" },
  ];
});
const listBoardPeople = vi.fn(async (
  projectKey: string,
  extraUserIds?: Array<string | null>,
) => {
  void projectKey;
  void extraUserIds;
  return [
    { id: "user-adam", name: "Adam" },
    { id: "user-derek", name: "Derek" },
  ];
});

vi.mock("@/lib/project-tasks/membership", () => ({
  userCanAccessProject: vi.fn(async (_user: unknown, project: string) =>
    project === "4studentlives" || project === "4StudentLives"
      ? "4studentlives"
      : null,
  ),
  listAssignableUsers: (projectKey: string) => listAssignableUsers(projectKey),
  listBoardPeople: (projectKey: string, extraUserIds?: Array<string | null>) =>
    listBoardPeople(projectKey, extraUserIds),
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
  notes: "",
  status: "open",
  sortOrder: 1,
  source: "ui",
  createdByUserId: "user-derek" as string | null,
  assigneeUserId: null as string | null,
  dueAt: null as Date | null,
  sectionId: "sec-sales" as string | null,
  sectionName: "Sales" as string | null,
  completedAt: null as Date | null,
  createdAt: new Date(),
  updatedAt: new Date(),
}));
const updateProjectTask = vi.fn(async () => ({
  id: "t2",
  projectKey: "4studentlives",
  title: "Update the site",
  description: "",
  notes: "",
  status: "open",
  sortOrder: 2,
  source: "ui",
  createdByUserId: null as string | null,
  assigneeUserId: null as string | null,
  dueAt: null as Date | null,
  sectionId: "sec-sales" as string | null,
  sectionName: "Sales" as string | null,
  completedAt: null as Date | null,
  createdAt: new Date(),
  updatedAt: new Date(),
}));
const resolveProjectTask = vi.fn(async () => ({
  id: "t2",
  projectKey: "4studentlives",
  title: "Update the site",
  description: "",
  notes: "",
  status: "open",
  sortOrder: 2,
  source: "ui",
  createdByUserId: null as string | null,
  assigneeUserId: null as string | null,
  dueAt: null as Date | null,
  sectionId: null as string | null,
  sectionName: null as string | null,
  completedAt: null as Date | null,
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
  notes: "",
  status: "done",
  sortOrder: 1,
  source: "ui",
  createdByUserId: "user-derek" as string | null,
  assigneeUserId: null as string | null,
  dueAt: null as Date | null,
  sectionId: "sec-sales" as string | null,
  sectionName: "Sales" as string | null,
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
    expect(data.tasks[0].notes).toBe("");
    expect(data.tasks[0].dueAt).toBeNull();
    expect(data.people).toEqual([
      { id: "user-adam", name: "Adam" },
      { id: "user-derek", name: "Derek" },
    ]);
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
      notes: "",
      dueAt: null,
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

  it("saves owner, due date, and notes without a separate section change", async () => {
    resolveProjectTask.mockResolvedValueOnce({
      id: "t1",
      projectKey: "4studentlives",
      title: "Call the district (owner: Derek, due 10/12/2026)",
      description: "",
      notes: "",
      status: "open",
      sortOrder: 1,
      source: "ui",
      createdByUserId: "user-derek",
      assigneeUserId: "user-derek",
      dueAt: new Date("2026-10-12T00:00:00.000Z"),
      sectionId: "sec-sales",
      sectionName: "Sales",
      completedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      number: 1,
    });
    updateProjectTask.mockResolvedValueOnce({
      id: "t1",
      projectKey: "4studentlives",
      title: "Call the district (owner: Adam, due 10/9/2026)",
      description: "",
      notes: "Bring the map",
      status: "open",
      sortOrder: 1,
      source: "ui",
      createdByUserId: "user-derek",
      assigneeUserId: "user-adam",
      dueAt: new Date("2026-10-09T00:00:00.000Z"),
      sectionId: "sec-sales",
      sectionName: "Sales",
      completedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const { PATCH } = await import("@/app/api/project-sections/route");
    const res = await PATCH(
      new Request("http://localhost:8080/api/project-sections", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project: "4studentlives",
          taskId: "t1",
          assigneeUserId: "user-adam",
          dueAt: "2026-10-09",
          notes: "  Bring the map  ",
        }),
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.task.assigneeUserId).toBe("user-adam");
    expect(data.task.dueAt).toBe("2026-10-09");
    expect(data.task.notes).toBe("Bring the map");
    expect(data.task.title).toBe("Call the district (owner: Adam, due 10/9/2026)");
    expect(updateProjectTask).toHaveBeenCalledWith("t1", {
      assigneeUserId: "user-adam",
      dueAt: new Date("2026-10-09T00:00:00.000Z"),
      notes: "Bring the map",
      title: "Call the district (owner: Adam, due 10/9/2026)",
    });
    expect(completeProjectTask).not.toHaveBeenCalled();
  });

  it("rejects an owner who is not on the project", async () => {
    resolveProjectTask.mockResolvedValueOnce({
      id: "t1",
      projectKey: "4studentlives",
      title: "Call the district",
      description: "",
      notes: "",
      status: "open",
      sortOrder: 1,
      source: "ui",
      createdByUserId: null,
      assigneeUserId: null,
      dueAt: null,
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
          taskId: "t1",
          assigneeUserId: "user-stranger",
        }),
      }),
    );
    expect(res.status).toBe(400);
    expect(updateProjectTask).not.toHaveBeenCalled();
  });
});
