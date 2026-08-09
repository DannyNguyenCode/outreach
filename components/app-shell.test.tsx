import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AppShell } from "@/components/app-shell";
import HomePage from "@/app/page";

describe("application shell", () => {
  it("renders the home heading inside the main landmark", () => {
    render(
      <AppShell>
        <HomePage />
      </AppShell>,
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "Outreach" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("banner")).toBeInTheDocument();
  });
});
