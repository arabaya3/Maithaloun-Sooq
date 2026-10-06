import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthorizationError } from "@/features/admin/domain/admin-actor";

import { CatalogAuthoringError } from "./catalog-authoring-service";

const setPublication = vi.fn();
const revalidatePath = vi.fn();
const requireTrustedAdminMutation = vi.fn();

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args),
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/features/admin/auth/admin-session", () => ({
  requireTrustedAdminMutation: () => requireTrustedAdminMutation(),
}));
vi.mock("./admin-services", () => ({
  catalogAuthoringService: {
    setPublication: (...args: unknown[]) => setPublication(...args),
  },
}));

const { bulkPublicationAction } = await import("./catalog-management-actions");

function form(ids: string[], publication: string) {
  const data = new FormData();
  for (const id of ids) data.append("domainId", id);
  data.set("publication", publication);
  return data;
}

beforeEach(() => {
  setPublication.mockReset();
  revalidatePath.mockReset();
  requireTrustedAdminMutation.mockResolvedValue({
    id: "owner",
    role: "owner",
    active: true,
  });
});

describe("bulk publication", () => {
  it("changes each product on its own and reports exactly which ones did not change and why", async () => {
    setPublication.mockImplementation(async (_actor, input) => {
      if (input.domainId === "not-ready") {
        throw new CatalogAuthoringError(
          "not_publishable",
          "اللون «أزرق» بلا صورة.",
        );
      }
    });
    const result = await bulkPublicationAction(
      null,
      form(["general-cleaner", "not-ready", "dish-soap"], "published"),
    );
    expect(result).toEqual({
      ok: true,
      changed: 2,
      failed: [
        {
          domainId: "not-ready",
          message: "المنتج غير جاهز للنشر. اللون «أزرق» بلا صورة.",
        },
      ],
    });
    expect(setPublication).toHaveBeenCalledTimes(3);
    // A bulk publish never accepts a placeholder picture on the owner's behalf.
    expect(
      setPublication.mock.calls.every(
        ([, input]) => input.acceptPlaceholder === false,
      ),
    ).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith("/admin/products");
  });

  it("refuses an operator before touching anything", async () => {
    setPublication.mockRejectedValue(new AuthorizationError());
    expect(
      await bulkPublicationAction(null, form(["a", "b"], "hidden")),
    ).toEqual({ ok: false, message: "هذا الإجراء للمالك فقط." });
    expect(setPublication).toHaveBeenCalledTimes(1);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects an empty selection, unknown states and duplicated ids", async () => {
    expect(await bulkPublicationAction(null, form([], "hidden"))).toMatchObject(
      {
        ok: false,
      },
    );
    expect(
      await bulkPublicationAction(null, form(["a"], "deleted")),
    ).toMatchObject({ ok: false });
    expect(
      await bulkPublicationAction(null, form(["../x"], "hidden")),
    ).toMatchObject({ ok: false });
    await bulkPublicationAction(null, form(["a", "a"], "hidden"));
    expect(setPublication).toHaveBeenCalledTimes(1);
  });
});
