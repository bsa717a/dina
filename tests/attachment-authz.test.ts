import { beforeEach, describe, expect, it, vi } from "vitest";

const requireReadySession = vi.fn();
const findUniqueAttachment = vi.fn();
const findUniqueMessage = vi.fn();
const conversationOwnedByUser = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  requireReadySession: () => requireReadySession(),
}));

vi.mock("@/lib/db/client", () => ({
  prisma: {
    attachment: {
      findUnique: (...args: unknown[]) => findUniqueAttachment(...args),
    },
    message: {
      findUnique: (...args: unknown[]) => findUniqueMessage(...args),
    },
  },
}));

vi.mock("@/lib/db/conversations", () => ({
  conversationOwnedByUser: (...args: unknown[]) =>
    conversationOwnedByUser(...args),
}));

vi.mock("@/lib/uploads/storage", () => ({
  readAttachmentBytes: vi.fn(async () => Buffer.from("ok")),
}));

describe("attachment download authz", () => {
  beforeEach(() => {
    vi.resetModules();
    requireReadySession.mockReset();
    findUniqueAttachment.mockReset();
    findUniqueMessage.mockReset();
    conversationOwnedByUser.mockReset();
    requireReadySession.mockResolvedValue({
      ok: true,
      user: {
        id: "member-1",
        name: "Alex",
        role: "member",
        username: "alex",
        assistantName: "Nora",
        assistantPersona: "",
        assistantKey: "nora",
        mustChangePassword: false,
      },
    });
  });

  it("hides another user's unlinked upload", async () => {
    findUniqueAttachment.mockResolvedValue({
      id: "a1",
      messageId: null,
      uploadedByUserId: "owner-1",
      filename: "secret.png",
      mimeType: "image/png",
      size: 12,
      storageKey: "secret.png",
    });
    const { GET } = await import("@/app/api/attachments/[id]/route");
    const res = await GET(new Request("http://localhost/api/attachments/a1"), {
      params: Promise.resolve({ id: "a1" }),
    });
    expect(res.status).toBe(404);
  });

  it("lets the owner fetch a legacy unlinked upload with no uploader", async () => {
    requireReadySession.mockResolvedValue({
      ok: true,
      user: {
        id: "owner-1",
        name: "Derek",
        role: "owner",
        username: "derek",
        assistantName: "Dina",
        assistantPersona: "",
        assistantKey: "dina",
        mustChangePassword: false,
      },
    });
    findUniqueAttachment.mockResolvedValue({
      id: "a1",
      messageId: null,
      uploadedByUserId: null,
      filename: "legacy.png",
      mimeType: "image/png",
      size: 12,
      storageKey: "legacy.png",
    });
    const { GET } = await import("@/app/api/attachments/[id]/route");
    const res = await GET(new Request("http://localhost/api/attachments/a1"), {
      params: Promise.resolve({ id: "a1" }),
    });
    expect(res.status).toBe(200);
  });

  it("hides a legacy unlinked upload from members", async () => {
    findUniqueAttachment.mockResolvedValue({
      id: "a1",
      messageId: null,
      uploadedByUserId: null,
      filename: "legacy.png",
      mimeType: "image/png",
      size: 12,
      storageKey: "legacy.png",
    });
    const { GET } = await import("@/app/api/attachments/[id]/route");
    const res = await GET(new Request("http://localhost/api/attachments/a1"), {
      params: Promise.resolve({ id: "a1" }),
    });
    expect(res.status).toBe(404);
  });

  it("allows the uploader to fetch their own unlinked upload", async () => {
    findUniqueAttachment.mockResolvedValue({
      id: "a1",
      messageId: null,
      uploadedByUserId: "member-1",
      filename: "mine.png",
      mimeType: "image/png",
      size: 12,
      storageKey: "mine.png",
    });
    const { GET } = await import("@/app/api/attachments/[id]/route");
    const res = await GET(new Request("http://localhost/api/attachments/a1"), {
      params: Promise.resolve({ id: "a1" }),
    });
    expect(res.status).toBe(200);
  });
});
