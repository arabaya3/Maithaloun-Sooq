import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { descriptionBlocks, ProductDescription } from "./product-description";

describe("product description formatting", () => {
  it("keeps the owner's line breaks, paragraphs and lists", () => {
    expect(
      descriptionBlocks(
        "منظف قوي للسجاد.\nآمن على الألوان.\n\nالمميزات:\n- يزيل البقع\n• رائحة منعشة\n\nطريقة الاستخدام:\n1. خففه بالماء\n2) افركه بالفرشاة",
      ),
    ).toEqual([
      { kind: "paragraph", lines: ["منظف قوي للسجاد.", "آمن على الألوان."] },
      { kind: "paragraph", lines: ["المميزات:"] },
      { kind: "bullets", items: ["يزيل البقع", "رائحة منعشة"] },
      { kind: "paragraph", lines: ["طريقة الاستخدام:"] },
      { kind: "numbers", items: ["خففه بالماء", "افركه بالفرشاة"] },
    ]);
  });

  it("reads a pasted literal \\n as a line break", () => {
    expect(
      descriptionBlocks("منظف قوي.\\nطريقة الاستعمال:\\n- رشّه\\n- امسحه"),
    ).toEqual([
      { kind: "paragraph", lines: ["منظف قوي.", "طريقة الاستعمال:"] },
      { kind: "bullets", items: ["رشّه", "امسحه"] },
    ]);
  });

  it("treats plain one-line text as one paragraph and never renders markup", () => {
    expect(descriptionBlocks("  نص واحد  ")).toEqual([
      { kind: "paragraph", lines: ["نص واحد"] },
    ]);
    render(<ProductDescription text={"<b>عريض</b>\n- بند"} />);
    expect(screen.getByText("<b>عريض</b>")).toBeInTheDocument();
    expect(screen.getByRole("listitem")).toHaveTextContent("بند");
  });
});
