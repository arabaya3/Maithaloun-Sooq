import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FavoritesProvider, useFavorites } from "./favorites-provider";
import { FAVORITES_STORAGE_KEY } from "./favorites-store";

function Probe() {
  const { favoriteIds, deviceOnlyIds, toggleFavorite, mergeDeviceFavorites } =
    useFavorites();
  return (
    <div>
      <output data-testid="ids">{favoriteIds.join(",")}</output>
      <output data-testid="device">{deviceOnlyIds.join(",")}</output>
      <button onClick={() => toggleFavorite("dolphin-bleach")}>toggle</button>
      <button onClick={() => void mergeDeviceFavorites()}>merge</button>
    </div>
  );
}

const productIds = ["general-cleaner", "dolphin-bleach", "carpet-brush"];

beforeEach(() => {
  window.localStorage.setItem(
    FAVORITES_STORAGE_KEY,
    JSON.stringify({ version: 1, productIds: ["general-cleaner"] }),
  );
});

describe("FavoritesProvider", () => {
  it("keeps guest favourites in validated local storage", async () => {
    render(
      <FavoritesProvider productIds={productIds}>
        <Probe />
      </FavoritesProvider>,
    );
    await act(async () => {});
    expect(screen.getByTestId("ids")).toHaveTextContent("general-cleaner");
    await userEvent.click(screen.getByText("toggle"));
    expect(
      JSON.parse(window.localStorage.getItem(FAVORITES_STORAGE_KEY)!)
        .productIds,
    ).toEqual(["general-cleaner", "dolphin-bleach"]);
  });

  it("uses account favourites when signed in and merges device ones only on request", async () => {
    const save = vi.fn().mockResolvedValue({ ok: true });
    const merge = vi.fn().mockResolvedValue({
      ok: true,
      added: 1,
      productIds: ["carpet-brush", "general-cleaner"],
    });
    render(
      <FavoritesProvider
        productIds={productIds}
        account={{ productIds: ["carpet-brush"], save, merge }}
      >
        <Probe />
      </FavoritesProvider>,
    );
    await act(async () => {});
    expect(screen.getByTestId("ids")).toHaveTextContent(/^carpet-brush$/);
    expect(screen.getByTestId("device")).toHaveTextContent("general-cleaner");
    expect(merge).not.toHaveBeenCalled();

    await userEvent.click(screen.getByText("toggle"));
    expect(save).toHaveBeenCalledWith("dolphin-bleach", true);
    expect(
      JSON.parse(window.localStorage.getItem(FAVORITES_STORAGE_KEY)!)
        .productIds,
    ).toEqual(["general-cleaner"]);

    await userEvent.click(screen.getByText("merge"));
    expect(merge).toHaveBeenCalledWith(["general-cleaner"]);
    expect(screen.getByTestId("device")).toHaveTextContent("");
  });

  it("rolls back an account change the server rejected", async () => {
    const save = vi.fn().mockResolvedValue({ ok: false });
    render(
      <FavoritesProvider
        productIds={productIds}
        account={{ productIds: [], save, merge: vi.fn() }}
      >
        <Probe />
      </FavoritesProvider>,
    );
    await userEvent.click(screen.getByText("toggle"));
    await act(async () => {});
    expect(screen.getByTestId("ids")).toHaveTextContent("");
  });
});
