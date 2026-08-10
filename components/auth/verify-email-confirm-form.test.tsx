import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions/auth", () => ({
  confirmVerificationAction: vi.fn(async () => ({
    status: "success",
    message: "Your email is verified. You can now sign in.",
  })),
}));

import { VerifyEmailConfirmForm } from "@/components/auth/verify-email-confirm-form";

describe("verify email confirmation form", () => {
  it("renders an accessible confirmation page without raw errors", () => {
    render(<VerifyEmailConfirmForm token="plausible-token-value-1234567890" />);
    expect(
      screen.getByRole("heading", { name: "Confirm email verification" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Verify email" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/prisma|stack|exception|tokenHash/i)).toBeNull();
  });

  it("disables submit while pending", async () => {
    const { confirmVerificationAction } = await import("@/app/actions/auth");
    vi.mocked(confirmVerificationAction).mockImplementationOnce(
      () =>
        new Promise(() => {
          /* pending */
        }) as Promise<{ status: "success"; message: string }>,
    );

    const user = userEvent.setup();
    render(<VerifyEmailConfirmForm token="plausible-token-value-1234567890" />);
    await user.click(screen.getByRole("button", { name: "Verify email" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Verifying…" })).toBeDisabled();
    });
  });
});
