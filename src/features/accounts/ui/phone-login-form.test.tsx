import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/i18n/i18n-provider";

const requestLoginCodeAction = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/features/accounts/application/account-actions", () => ({
  requestLoginCodeAction: (input: unknown) => requestLoginCodeAction(input),
  verifyLoginCodeAction: vi.fn(),
}));

import { PhoneLoginForm } from "./phone-login-form";

describe("PhoneLoginForm", () => {
  it("keeps the Arabic copy by default", () => {
    render(<PhoneLoginForm next="/account" />);
    expect(screen.getByText("رقم الجوال")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "إرسال رمز التحقق" }),
    ).toBeInTheDocument();
  });

  it("renders English copy, then the code step", async () => {
    requestLoginCodeAction.mockResolvedValue({
      ok: true,
      phoneE164: "+970591234567",
    });
    render(
      <I18nProvider locale="en">
        <PhoneLoginForm next="/account" />
      </I18nProvider>,
    );
    expect(screen.getByText("Mobile number")).toBeInTheDocument();
    expect(screen.getByLabelText("Local number")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Local number"), "0591234567");
    await userEvent.click(
      screen.getByRole("button", { name: "Send verification code" }),
    );

    expect(await screen.findByLabelText("Verification code")).toBeVisible();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Change number or resend" }),
    ).toBeInTheDocument();
  });
});
