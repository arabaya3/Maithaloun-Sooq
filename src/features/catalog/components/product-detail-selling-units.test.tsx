import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CART_STORAGE_KEY } from "@/features/cart/cart-store";
import { ProductDetailPanel } from "@/features/catalog/components/product-detail-panel";
import {
  fixtureUuid,
  multipackClothFixture,
} from "@/test/mock-product-repository";
import { renderWithProviders } from "@/test/render-with-providers";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

beforeEach(() => {
  window.history.replaceState(null, "", "/products/test-cloth");
});

function renderCloth(stock: { blueFreePieces?: number } = {}) {
  const product = multipackClothFixture({
    blueFreePieces: stock.blueFreePieces ?? 10,
    greenFreePieces: 20,
  });
  renderWithProviders(
    <ProductDetailPanel product={product} categoryLabel="أدوات التنظيف" />,
    { products: [product] },
  );
  return { user: userEvent.setup(), product };
}

const purchaseOptions = () =>
  within(screen.getByRole("radiogroup", { name: "طريقة الشراء" }));

describe("product page selling units", () => {
  it("offers a single and a 3-pack with factual per-piece pricing", () => {
    renderCloth();
    const options = purchaseOptions();
    const single = options.getByRole("radio", { name: /حبة واحدة/ });
    const pack = options.getByRole("radio", { name: /باكيج 3 حبات/ });
    expect(single).toHaveAttribute("aria-checked", "true");
    expect(single).toHaveTextContent("4 ₪");
    expect(pack).toHaveAttribute("aria-checked", "false");
    expect(pack).toHaveTextContent("10 ₪");
    expect(pack).toHaveTextContent("3.33 ₪ للحبة");
    expect(pack).toHaveTextContent("أوفر من شراء الحبة منفردة");
    expect(pack).not.toHaveTextContent("%");
    expect(screen.getByLabelText("السعر 4 ₪")).toBeInTheDocument();
  });

  it("adds two 3-packs as packs, not as two pieces", async () => {
    const { user } = renderCloth();
    await user.click(purchaseOptions().getByRole("radio", { name: /باكيج 3/ }));
    expect(screen.getByLabelText("السعر 10 ₪")).toBeInTheDocument();
    expect(screen.getByText(/العدد من/)).toHaveTextContent(
      "العدد من «باكيج 3 حبات»",
    );
    await user.click(
      screen.getByRole("button", {
        name: "زيادة كمية ممسحة تنظيف — باكيج 3 حبات",
      }),
    );
    expect(screen.getByText(/2 × باكيج 3 حبات/)).toHaveTextContent(
      "2 × باكيج 3 حبات = 6 حبات · 20 ₪",
    );
    await user.click(screen.getByRole("button", { name: "أضف إلى السلة" }));
    expect(
      JSON.parse(window.localStorage.getItem(CART_STORAGE_KEY) ?? "{}").lines,
    ).toEqual([
      {
        productId: "test-cloth",
        variantId: "test-cloth--blue",
        sellingUnitId: fixtureUuid("test-cloth--blue:pack3"),
        unitsPerSale: 3,
        quantity: 2,
      },
    ]);
  });

  it("disables the pack when stock cannot fill it and caps singles", async () => {
    const { user } = renderCloth({ blueFreePieces: 2 });
    const pack = purchaseOptions().getByRole("radio", { name: /باكيج 3/ });
    expect(pack).toBeDisabled();
    expect(pack).toHaveTextContent("غير متوفر حالياً");
    const increase = screen.getByRole("button", {
      name: "زيادة كمية ممسحة تنظيف",
    });
    await user.click(increase);
    expect(increase).toBeDisabled();
  });

  it("re-resolves ways of buying when the colour changes", async () => {
    const { user } = renderCloth();
    await user.click(purchaseOptions().getByRole("radio", { name: /باكيج 3/ }));
    await user.click(screen.getByRole("radio", { name: "أخضر" }));
    const options = purchaseOptions();
    // Green has no 3-pack: its default single is chosen, never a silent conversion.
    expect(options.queryByRole("radio", { name: /باكيج 3/ })).toBeNull();
    expect(options.getByRole("radio", { name: /حبة واحدة/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(options.getByRole("radio", { name: /كرتونة 6/ })).toHaveTextContent(
      "24 ₪",
    );
    expect(screen.getByLabelText("السعر 4.5 ₪")).toBeInTheDocument();
  });

  it("keeps the chosen quantity when the colour changes", async () => {
    const { user } = renderCloth();
    const more = () =>
      screen.getByRole("button", { name: "زيادة كمية ممسحة تنظيف" });
    await user.click(more());
    await user.click(more());
    await user.click(screen.getByRole("radio", { name: "أخضر" }));
    expect(screen.getByLabelText("كمية ممسحة تنظيف الحالية")).toHaveTextContent(
      "3",
    );
  });

  it("keeps the way of buying in the address and restores it on load", async () => {
    const { user } = renderCloth();
    await user.click(purchaseOptions().getByRole("radio", { name: /باكيج 3/ }));
    const unit = new URL(window.location.href).searchParams.get("unit");
    expect(unit).toBe(fixtureUuid("test-cloth--blue:pack3"));
    await user.click(
      purchaseOptions().getByRole("radio", { name: /حبة واحدة/ }),
    );
    expect(new URL(window.location.href).searchParams.get("unit")).toBeNull();

    document.body.innerHTML = "";
    window.history.replaceState(null, "", `/products/test-cloth?unit=${unit}`);
    renderCloth();
    expect(
      purchaseOptions().getByRole("radio", { name: /باكيج 3/ }),
    ).toHaveAttribute("aria-checked", "true");
  });

  it("does not keep an old “added” message after the choice changes", async () => {
    const { user } = renderCloth();
    await user.click(screen.getByRole("button", { name: "أضف إلى السلة" }));
    expect(screen.getByText(/تمت إضافة/)).toBeInTheDocument();
    await user.click(purchaseOptions().getByRole("radio", { name: /باكيج 3/ }));
    expect(screen.queryByText(/تمت إضافة/)).toBeNull();
  });

  it("moves between ways of buying with arrow keys", async () => {
    const { user } = renderCloth();
    purchaseOptions()
      .getByRole("radio", { name: /حبة واحدة/ })
      .focus();
    await user.keyboard("{ArrowLeft}");
    const pack = purchaseOptions().getByRole("radio", { name: /باكيج 3/ });
    expect(pack).toHaveAttribute("aria-checked", "true");
    expect(pack).toHaveFocus();
  });
});
