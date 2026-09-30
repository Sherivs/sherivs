import { z } from "zod";

/** Shared validators reused by client forms and server fn input validators. */

export const nonEmptyText = (label: string, max = 200) =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} must be ${max} characters or less`);

export const optionalText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max, `Must be ${max} characters or less`)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null));

export const emailField = z
  .string({ error: "Email is required" })
  .trim()
  .toLowerCase()
  .email("Enter a valid email")
  .max(255);

export const optionalEmail = emailField
  .optional()
  .or(z.literal(""))
  .transform((v) => (v ? v : null));

export const hexColor = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use a 6-digit hex color like #1d4ed8");

export const optionalHexColor = hexColor
  .optional()
  .or(z.literal(""))
  .transform((v) => (v ? v : null));

export const urlField = z
  .string()
  .trim()
  .url("Enter a valid URL")
  .max(2048)
  .optional()
  .or(z.literal(""))
  .transform((v) => (v ? v : null));

export const phoneField = z
  .string()
  .trim()
  .max(40)
  .regex(/^[\d\s+()\-.]*$/, "Phone can only contain digits, spaces and + ( ) - .")
  .optional()
  .or(z.literal(""))
  .transform((v) => (v ? v : null));

export const yearField = z
  .union([z.number(), z.string()])
  .transform((v) => (v === "" || v === null || v === undefined ? null : Number(v)))
  .refine(
    (v) => v === null || (Number.isInteger(v) && v >= 1800 && v <= new Date().getFullYear() + 1),
    { message: "Enter a valid founding year" },
  );

export const subscriptionTier = z.enum([
  "trial",
  "starter",
  "growth",
  "professional",
  "enterprise",
]);
