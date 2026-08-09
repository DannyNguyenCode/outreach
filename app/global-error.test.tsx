import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import GlobalError from "@/app/global-error";

describe("GlobalError", () => {
  it("renders a safe message, hides the raw error, and calls reset", async () => {
    const user = userEvent.setup();
    const reset = vi.fn();
    const secretMessage =
      "DATABASE_URL=postgresql://secret@db/outreach leaked stack";

    render(
      <GlobalError
        error={Object.assign(new Error(secretMessage), { digest: "abc123" })}
        reset={reset}
      />,
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "Something went wrong" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/an unexpected error occurred/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(secretMessage)).not.toBeInTheDocument();
    expect(screen.queryByText(/DATABASE_URL/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/abc123/)).not.toBeInTheDocument();

    const retry = screen.getByRole("button", { name: "Try again" });
    expect(retry).toBeEnabled();
    await user.click(retry);
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
