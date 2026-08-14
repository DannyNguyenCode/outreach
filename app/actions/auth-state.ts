export type ActionState = {
  status: "idle" | "success" | "error" | "unverified" | "rate_limited";
  message?: string;
  fieldErrors?: Record<string, string[]>;
  /** Optional non-sensitive payload (e.g. Phase 3B template-switch preview). */
  data?: unknown;
};

export const initialActionState: ActionState = { status: "idle" };
