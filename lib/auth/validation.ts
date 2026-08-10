import { z } from "zod";

import { emailSchema } from "@/lib/auth/email";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  validatePasswordPolicy,
} from "@/lib/auth/password";

const nameSchema = z
  .string()
  .trim()
  .min(1, "Name is required.")
  .max(100, "Name is too long.");

const passwordFieldSchema = z
  .string()
  .min(1, "Password is required.")
  .max(
    PASSWORD_MAX_LENGTH,
    `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`,
  )
  .superRefine((value, ctx) => {
    const issue = validatePasswordPolicy(value);
    if (issue === "too_short") {
      ctx.addIssue({
        code: "custom",
        message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
      });
    } else if (issue === "whitespace_only") {
      ctx.addIssue({
        code: "custom",
        message: "Password cannot be only whitespace.",
      });
    } else if (issue === "empty") {
      ctx.addIssue({
        code: "custom",
        message: "Password is required.",
      });
    }
  });

export const registerSchema = z
  .object({
    name: nameSchema,
    email: emailSchema,
    password: passwordFieldSchema,
    confirmPassword: z.string().min(1, "Confirm your password."),
  })
  .superRefine((data, ctx) => {
    if (data.password !== data.confirmPassword) {
      ctx.addIssue({
        code: "custom",
        path: ["confirmPassword"],
        message: "Passwords do not match.",
      });
    }
  });

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required.").max(PASSWORD_MAX_LENGTH),
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resendVerificationSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z
  .object({
    token: z.string().min(1, "Reset token is required.").max(256),
    password: passwordFieldSchema,
    confirmPassword: z.string().min(1, "Confirm your password."),
  })
  .superRefine((data, ctx) => {
    if (data.password !== data.confirmPassword) {
      ctx.addIssue({
        code: "custom",
        path: ["confirmPassword"],
        message: "Passwords do not match.",
      });
    }
  });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
