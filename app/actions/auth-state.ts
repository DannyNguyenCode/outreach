export type ActionState = {
  status: "idle" | "success" | "error" | "unverified" | "rate_limited";
  message?: string;
  fieldErrors?: Record<string, string[]>;
};

export const initialActionState: ActionState = { status: "idle" };
