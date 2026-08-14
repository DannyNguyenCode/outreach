import { Prisma } from "@prisma/client";
import { z } from "zod";

/**
 * ISO 4217 currency codes commonly needed by hosted SaaS orgs.
 * Unknown codes are rejected rather than silently accepted.
 */
export const SUPPORTED_CURRENCY_CODES = [
  "USD",
  "CAD",
  "EUR",
  "GBP",
  "AUD",
  "NZD",
  "CHF",
  "JPY",
  "INR",
  "MXN",
  "BRL",
  "SGD",
  "HKD",
  "SEK",
  "NOK",
  "DKK",
  "PLN",
  "ZAR",
  "AED",
  "PHP",
] as const;

export type SupportedCurrencyCode = (typeof SUPPORTED_CURRENCY_CODES)[number];

const SUPPORTED_CURRENCY_SET = new Set<string>(SUPPORTED_CURRENCY_CODES);

export const currencyCodeSchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .refine(
    (value): value is SupportedCurrencyCode =>
      SUPPORTED_CURRENCY_SET.has(value),
    "Enter a supported ISO 4217 currency code.",
  );

/**
 * Parse a money amount into Prisma.Decimal without using JS number as authority.
 * Accepts decimal strings and integers; rejects NaN, Infinity, and scientific notation.
 */
export function parseMoneyDecimal(raw: unknown): Prisma.Decimal | null {
  if (raw instanceof Prisma.Decimal) {
    if (raw.isNaN() || !raw.isFinite()) return null;
    return raw;
  }
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return null;
    // Convert via string to avoid binary float artifacts where possible.
    return new Prisma.Decimal(String(raw));
  }
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null;
  try {
    const value = new Prisma.Decimal(trimmed);
    if (value.isNaN() || !value.isFinite()) return null;
    return value;
  } catch {
    return null;
  }
}

export const moneyAmountSchema = z.unknown().transform((raw, ctx) => {
  const value = parseMoneyDecimal(raw);
  if (!value) {
    ctx.addIssue({
      code: "custom",
      message: "Enter a valid money amount.",
    });
    return z.NEVER;
  }
  if (value.isNegative()) {
    ctx.addIssue({
      code: "custom",
      message: "Amount cannot be negative.",
    });
    return z.NEVER;
  }
  // NUMERIC(19,4): at most 15 digits before decimal, 4 after.
  const [whole = "0", fraction = ""] = value.abs().toFixed().split(".");
  if (whole.replace(/^0+/, "").length > 15 || fraction.length > 4) {
    ctx.addIssue({
      code: "custom",
      message: "Amount is out of supported range.",
    });
    return z.NEVER;
  }
  return value;
});

export function moneyToCanonicalString(value: Prisma.Decimal): string {
  return value.toFixed(4);
}
