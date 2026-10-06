import { beforeEach, describe, expect, it, vi } from "vitest";

const references = vi.fn();
const getByDomainId = vi.fn();
const deleteUnreferenced = vi.fn();
const archive = vi.fn();
const redirect = vi.fn((url: string): never => {
  throw Object.assign(new Error(`NEXT_REDIRECT:${url}`), { url });
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirect(url),
}));
vi.mock("@/features/admin/auth/admin-session", () => ({
  requireTrustedAdminMutation: async () => ({
    id: "owner",
    role: "owner",
    active: true,
  }),
}));
vi.mock("./admin-services", () => ({
  catalogAuthoringService: {},
  adminCatalogService: {
    getByDomainId: (...args: unknown[]) => getByDomainId(...args),
  },
  productMaintenanceService: {
    references: (...args: unknown[]) => references(...args),
    deleteUnreferenced: (...args: unknown[]) => deleteUnreferenced(...args),
    archive: (...args: unknown[]) => archive(...args),
  },
}));

const { deleteProductAction, archiveProductAction } =
  await import("./catalog-management-actions");

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const none = { orders: 0, purchases: 0, sales: 0, stockMovements: 0 };

beforeEach(() => {
  references.mockReset().mockResolvedValue(none);
  getByDomainId.mockReset().mockResolvedValue({ nameAr: "منتج للحذف" });
  deleteUnreferenced.mockReset().mockResolvedValue({ deleted: true });
  archive.mockReset();
  redirect.mockClear();
});

describe("permanent delete", () => {
  it("re-scans references on the server and refuses a product with history", async () => {
    references.mockResolvedValue({ ...none, orders: 1 });
    expect(
      await deleteProductAction(
        null,
        form({ domainId: "used", confirmName: "منتج للحذف" }),
      ),
    ).toEqual({
      ok: false,
      message:
        "المنتج مرتبط بسجلات، فلا يمكن حذفه نهائياً. أرشفيه بدلاً من ذلك.",
    });
    expect(deleteUnreferenced).not.toHaveBeenCalled();
  });

  it("requires the exact product name, whatever the page sent", async () => {
    expect(
      await deleteProductAction(
        null,
        form({ domainId: "unused", confirmName: "منتج" }),
      ),
    ).toMatchObject({ ok: false });
    expect(deleteUnreferenced).not.toHaveBeenCalled();
  });

  it("deletes and returns to the list with the product's name", async () => {
    await expect(
      deleteProductAction(
        null,
        form({ domainId: "unused", confirmName: "منتج للحذف" }),
      ),
    ).rejects.toMatchObject({
      url: `/admin/products?deleted=${encodeURIComponent("منتج للحذف")}`,
    });
    expect(deleteUnreferenced).toHaveBeenCalledWith(
      expect.objectContaining({ role: "owner" }),
      "unused",
    );
  });
});

describe("archive", () => {
  it("passes the reason through and reports the product as archived", async () => {
    await expect(
      archiveProductAction(
        null,
        form({ domainId: "general-cleaner", reason: "توقف المورد" }),
      ),
    ).rejects.toMatchObject({
      url: expect.stringMatching(
        /^\/admin\/products\/general-cleaner\?saved=archived&at=\d+$/,
      ),
    });
    expect(archive).toHaveBeenCalledWith(expect.anything(), {
      domainId: "general-cleaner",
      reason: "توقف المورد",
    });
  });
});
