import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions/auth", () => ({
  registerAction: vi.fn(async () => ({
    status: "success",
    message:
      "If the email can receive mail, a verification link has been sent.",
  })),
  loginAction: vi.fn(async () => ({
    status: "error",
    message: "Invalid email or password.",
  })),
  forgotPasswordAction: vi.fn(async () => ({
    status: "success",
    message:
      "If an account exists for that email, password reset instructions have been sent.",
  })),
  resetPasswordAction: vi.fn(async (_prev: unknown, formData: FormData) => {
    const password = String(formData.get("password") ?? "");
    if (password.length < 12) {
      return {
        status: "error",
        message: "Please correct the highlighted fields.",
        fieldErrors: {
          password: ["Password must be at least 12 characters."],
        },
      };
    }
    return {
      status: "error",
      message: "This reset link is invalid or has already been used.",
    };
  }),
}));

import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { LoginForm } from "@/components/auth/login-form";
import { RegisterForm } from "@/components/auth/register-form";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { SubmitButton } from "@/components/auth/submit-button";

describe("auth forms", () => {
  it("renders the registration form accessibly", () => {
    render(<RegisterForm />);
    expect(
      screen.getByRole("heading", { name: "Create an account" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toHaveAttribute(
      "type",
      "password",
    );
    expect(screen.getByLabelText("Password")).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
    expect(screen.getByLabelText("Confirm password")).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
  });

  it("renders the login form accessibly", () => {
    render(<LoginForm callbackUrl="/app" />);
    expect(
      screen.getByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveAttribute(
      "autocomplete",
      "email",
    );
    expect(screen.getByLabelText("Password")).toHaveAttribute(
      "autocomplete",
      "current-password",
    );
  });

  it("shows a generic forgot-password success state", async () => {
    const user = userEvent.setup();
    render(<ForgotPasswordForm />);
    await user.type(screen.getByLabelText("Email"), "anyone@example.com");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(
      await screen.findByText(
        /if an account exists for that email, password reset instructions have been sent/i,
      ),
    ).toBeInTheDocument();
  });

  it("renders reset-password validation safely without raw server errors", async () => {
    const user = userEvent.setup();
    render(<ResetPasswordForm token="test-token" />);
    await user.type(screen.getByLabelText("New password"), "short");
    await user.type(screen.getByLabelText("Confirm new password"), "short");
    await user.click(screen.getByRole("button", { name: "Update password" }));
    expect(
      screen.queryByText(/prisma|stack|exception/i),
    ).not.toBeInTheDocument();
  });

  it("disables submit while pending to prevent duplicate submissions", async () => {
    function PendingForm() {
      return (
        <form
          action={async () => {
            await new Promise(() => {
              /* never resolves — keeps pending true */
            });
          }}
        >
          <SubmitButton pendingLabel="Creating account…">
            Create account
          </SubmitButton>
        </form>
      );
    }

    const user = userEvent.setup();
    render(<PendingForm />);
    await user.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Creating account…" }),
      ).toBeDisabled();
    });
  });
});
