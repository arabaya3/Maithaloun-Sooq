import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const draftAction = vi.fn();
const planAction = vi.fn();
const push = vi.fn();

vi.mock("@/features/admin/application/product-wizard-actions", () => ({
  createWizardDraftAction: (...args: unknown[]) => draftAction(...args),
}));
vi.mock("@/features/admin/application/product-media-actions", () => ({
  applyOptionPlanAction: (...args: unknown[]) => planAction(...args),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { AdminCategoriesProvider } from "./admin-categories";
import { BasicInfoStep, OptionsStep, WizardProgress } from "./product-wizard";
import { wizardStepHref } from "../domain/product-wizard-steps";

beforeEach(() => {
  draftAction.mockReset();
  planAction.mockReset();
  push.mockReset();
  window.localStorage.clear();
});

describe("product wizard navigation", () => {
  it("keeps steps 1–2 in the wizard and continues 3–5 in the product's own workspace", () => {
    expect(wizardStepHref(1, null)).toBe("/admin/products/new");
    expect(wizardStepHref(3, null)).toBeNull();
    expect(wizardStepHref(2, "soap-1a2b")).toBe(
      "/admin/products/new?product=soap-1a2b&step=2",
    );
    expect(wizardStepHref(3, "soap-1a2b")).toBe(
      "/admin/products/soap-1a2b?guide=images#images",
    );
    expect(wizardStepHref(5, "soap-1a2b")).toBe(
      "/admin/products/soap-1a2b?guide=review#publication",
    );
  });

  it("marks the current step and locks later steps until a draft exists", () => {
    render(<WizardProgress current={1} productId={null} />);
    const steps = screen.getByRole("list", { name: "خطوات إضافة المنتج" });
    expect(
      within(steps).getByText("المعلومات الأساسية").closest("[aria-current]"),
    ).toHaveAttribute("aria-current", "step");
    expect(
      within(steps).getByText("الصور").closest("[aria-disabled]"),
    ).toHaveAttribute("aria-disabled", "true");
    expect(within(steps).queryAllByRole("link")).toHaveLength(0);
  });
});

describe("basic information step", () => {
  it("reads live categories and keeps typed values, focusing the field the server rejected", async () => {
    const user = userEvent.setup();
    draftAction.mockResolvedValue({
      ok: false,
      field: "priceIls",
      message: "اكتبي سعر البيع بالشيكل، مثل 12 أو 12.50.",
    });
    render(
      <AdminCategoriesProvider
        categories={[
          { code: "kitchen", nameAr: "منظفات المطبخ" },
          { code: "car-care", nameAr: "العناية بالسيارة" },
        ]}
      >
        <BasicInfoStep />
      </AdminCategoriesProvider>,
    );
    expect(
      screen.getByRole("option", { name: "العناية بالسيارة" }),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText("اسم المنتج بالعربية"), "معطر سيارة");
    await user.selectOptions(screen.getByLabelText("القسم"), "car-care");
    await user.type(screen.getByLabelText("سعر البيع ₪"), "عشرة دولار");
    await user.click(
      screen.getByRole("button", { name: "التالي: الخيارات والمخزون" }),
    );
    expect(
      await screen.findByText("اكتبي سعر البيع بالشيكل، مثل 12 أو 12.50."),
    ).toBeVisible();
    const price = screen.getByLabelText("سعر البيع ₪");
    await waitFor(() => expect(price).toHaveFocus());
    expect(price).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("اسم المنتج بالعربية")).toHaveValue(
      "معطر سيارة",
    );
    expect(screen.getByLabelText("القسم")).toHaveValue("car-care");
  });
});

describe("options step", () => {
  it("builds only the combinations the owner keeps and sends them in option order", async () => {
    const user = userEvent.setup();
    planAction.mockResolvedValue({ ok: true });
    render(<OptionsStep productId="spray-1a2b" priceLabel="12 ₪" />);
    await user.click(
      screen.getByRole("radio", { name: "أكثر من نوع من الخيارات" }),
    );
    await user.type(
      screen.getByLabelText("أضيفي قيمة لـ الرائحة"),
      "لافندر، الورد الأبيض{Enter}",
    );
    await user.type(
      screen.getByLabelText("أضيفي قيمة لـ الحجم"),
      "750 مل، 1 لتر{Enter}",
    );
    const list = screen.getByRole("group", { name: /الأصناف التي ستُنشأ/ });
    expect(within(list).getAllByRole("checkbox")).toHaveLength(4);
    await user.click(
      within(list).getByRole("checkbox", { name: "لافندر – 1 لتر" }),
    );
    expect(list).toHaveTextContent("الأصناف التي ستُنشأ (3 من 4)");
    await user.click(screen.getByRole("button", { name: "التالي: الصور" }));

    await waitFor(() => expect(planAction).toHaveBeenCalledOnce());
    const [{ plan }] = planAction.mock.calls[0]!;
    expect(plan).toEqual({
      options: [
        {
          nameAr: "الرائحة",
          kind: "fragrance",
          values: ["لافندر", "الورد الأبيض"],
        },
        { nameAr: "الحجم", kind: "size", values: ["750 مل", "1 لتر"] },
      ],
      combinations: [
        ["لافندر", "750 مل"],
        ["الورد الأبيض", "750 مل"],
        ["الورد الأبيض", "1 لتر"],
      ],
    });
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        "/admin/products/spray-1a2b?guide=images#images",
      ),
    );
  });

  it("names the missing value without sending, and keeps the work after a server refusal", async () => {
    const user = userEvent.setup();
    render(<OptionsStep productId="spray-1a2b" priceLabel="12 ₪" />);
    await user.click(screen.getByRole("radio", { name: "روائح متعددة" }));
    await user.click(screen.getByRole("button", { name: "التالي: الصور" }));
    expect(
      screen.getByText("أضيفي قيمة واحدة على الأقل لـ «الرائحة».", {
        exact: false,
      }),
    ).toBeVisible();
    expect(planAction).not.toHaveBeenCalled();

    planAction.mockResolvedValue({
      ok: false,
      message:
        "لهذا المنتج خيارات أو أصناف من قبل؛ عدّليها من قسم الخيارات والأصناف.",
    });
    await user.type(
      screen.getByLabelText("أضيفي قيمة لـ الرائحة"),
      "لافندر{Enter}",
    );
    await user.click(screen.getByRole("button", { name: "التالي: الصور" }));
    expect(
      await screen.findByText(/لهذا المنتج خيارات أو أصناف من قبل/),
    ).toBeVisible();
    expect(screen.getByRole("list", { name: "قيم الرائحة" })).toHaveTextContent(
      "لافندر",
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("a single-variant product goes straight on to images", async () => {
    const user = userEvent.setup();
    render(<OptionsStep productId="spray-1a2b" priceLabel="12 ₪" />);
    await user.click(screen.getByRole("radio", { name: "منتج بخيار واحد" }));
    await user.click(screen.getByRole("button", { name: "التالي: الصور" }));
    expect(planAction).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith(
      "/admin/products/spray-1a2b?guide=images#images",
    );
  });
});
