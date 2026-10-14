import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { splitProductText } from "@/features/catalog/components/product-description";
import { ProductInformation } from "@/features/catalog/components/product-information";
import { renderWithProviders } from "@/test/render-with-providers";

// The real catalog shape: description, a label line, then the usage text.
const REAL =
  "مكنسة بشعيرات كثيفة لكنس الأرضيات.\nطريقة الاستعمال:\nتُركّب العصا وتُثبّت جيداً، ثم تُستخدم لكنس الأرضيات.";

describe("product information", () => {
  it("splits description and usage at the label without losing or repeating text", () => {
    expect(splitProductText(REAL)).toEqual({
      description: "مكنسة بشعيرات كثيفة لكنس الأرضيات.",
      usage: "تُركّب العصا وتُثبّت جيداً، ثم تُستخدم لكنس الأرضيات.",
    });
    expect(splitProductText("منظف.\nالاستعمال: يُرش على السطح.")).toEqual({
      description: "منظف.",
      usage: "يُرش على السطح.",
    });
    expect(splitProductText("Cleaner.\nHow to use:\nSpray and wipe.")).toEqual({
      description: "Cleaner.",
      usage: "Spray and wipe.",
    });
  });

  it("keeps uncertain text whole in the description", () => {
    for (const text of [
      "منظف بدون تعليمات.",
      "طريقة الاستعمال:\nيُرش على السطح.",
      "منظف قوي.\nطريقة الاستعمال:",
      "يذكر طريقة الاستعمال في منتصف الجملة: يُرش.",
    ]) {
      expect(splitProductText(text)).toEqual({
        description: text,
        usage: null,
      });
    }
  });

  it("renders titled sections and never invents numbered steps", () => {
    const { container } = renderWithProviders(
      <ProductInformation description={REAL} />,
      { products: [] },
    );
    expect(
      screen.getByRole("heading", { name: "وصف المنتج" }),
    ).toBeInTheDocument();
    const usage = screen
      .getByRole("heading", { name: "طريقة الاستعمال" })
      .closest("section")!;
    expect(usage).toHaveTextContent("تُركّب العصا وتُثبّت جيداً");
    expect(container.querySelector("ol")).toBeNull();
    expect(container.textContent?.match(/تُركّب العصا/g)).toHaveLength(1);
  });

  it("uses a separate usage field only when the description has none", () => {
    renderWithProviders(
      <ProductInformation description="منظف." usageNotes="يُرش ثم يُمسح." />,
      { products: [] },
    );
    expect(
      screen.getByRole("heading", { name: "طريقة الاستعمال" }),
    ).toBeInTheDocument();
    expect(screen.getByText("يُرش ثم يُمسح.")).toBeInTheDocument();
  });
});
