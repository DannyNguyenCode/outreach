import { describe, expect, it } from "vitest";

import {
  clientEnvSchema,
  formatEnvErrors,
  serverEnvSchema,
} from "@/lib/env/schema";

describe("serverEnvSchema", () => {
  it("accepts valid database and node environment values", () => {
    const result = serverEnvSchema.safeParse({
      DATABASE_URL:
        "postgresql://postgres:postgres@127.0.0.1:5432/outreach?schema=public",
      DIRECT_URL:
        "postgresql://postgres:postgres@127.0.0.1:5432/outreach?schema=public",
      NODE_ENV: "test",
    });

    expect(result.success).toBe(true);
  });

  it("rejects missing DATABASE_URL with a clear issue path", () => {
    const result = serverEnvSchema.safeParse({
      DIRECT_URL:
        "postgresql://postgres:postgres@127.0.0.1:5432/outreach?schema=public",
      NODE_ENV: "test",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(formatEnvErrors(result.error)).toContain("DATABASE_URL");
    }
  });
});

describe("clientEnvSchema", () => {
  it("accepts a valid public app URL", () => {
    const result = clientEnvSchema.safeParse({
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    });

    expect(result.success).toBe(true);
  });

  it("rejects an invalid public app URL", () => {
    const result = clientEnvSchema.safeParse({
      NEXT_PUBLIC_APP_URL: "not-a-url",
    });

    expect(result.success).toBe(false);
  });
});
