import { z } from "zod";

export type FieldErrors = Record<string, string[]>;

export type SplitActionError = {
  formError: string | null;
  fieldErrors: FieldErrors;
};

function cleanMessages(messages: string[]): string[] {
  return messages.map((message) => message.trim()).filter((message) => message.length > 0);
}

export function normalizeFieldErrors(
  value: Record<string, string[] | undefined> | FieldErrors,
): FieldErrors {
  const fieldErrors: FieldErrors = {};
  for (const [key, messages] of Object.entries(value)) {
    if (!messages) continue;
    const cleaned = cleanMessages(messages);
    if (cleaned.length > 0) fieldErrors[key] = cleaned;
  }
  return fieldErrors;
}

function isFieldErrorMap(value: unknown): value is Record<string, string[] | undefined> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every(
    (item) =>
      item === undefined ||
      (Array.isArray(item) && item.every((message) => typeof message === "string")),
  );
}

export function splitActionError(error: unknown): SplitActionError {
  if (typeof error === "string") {
    const trimmed = error.trim();
    return { formError: trimmed.length > 0 ? trimmed : null, fieldErrors: {} };
  }

  if (isFieldErrorMap(error)) {
    return { formError: null, fieldErrors: normalizeFieldErrors(error) };
  }

  return {
    formError: "Something went wrong. Please check your details and try again.",
    fieldErrors: {},
  };
}

export function flattenZodFieldErrors(error: z.ZodError): FieldErrors {
  return normalizeFieldErrors(z.flattenError(error).fieldErrors);
}

export function firstZodMessage(error: z.ZodError): string | undefined {
  return error.issues
    .map((issue) => issue.message.trim())
    .find((message) => message.length > 0);
}

export function firstFieldError(
  fieldErrors: FieldErrors,
  field: string,
): string | undefined {
  return fieldErrors[field]?.find((message) => message.trim().length > 0);
}

export function summarizeFieldErrors(
  fieldErrors: FieldErrors,
  fallback: string,
): string {
  for (const messages of Object.values(fieldErrors)) {
    const message = messages.find((candidate) => candidate.trim().length > 0);
    if (message) return message;
  }
  return fallback;
}

export function uniqueErrorMessages(
  fieldErrors: FieldErrors,
  formError?: string | null,
): string[] {
  const seen = new Set<string>();
  const messages: string[] = [];

  function add(message: string) {
    const trimmed = message.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    messages.push(trimmed);
  }

  if (formError) add(formError);
  for (const list of Object.values(fieldErrors)) {
    for (const message of list) add(message);
  }
  return messages;
}

export function publicAuthErrorMessage(message: string, fallback: string): string {
  const trimmed = message.trim();
  if (!trimmed) return fallback;
  const lower = trimmed.toLowerCase();
  if (lower.includes("invalid login") || lower.includes("invalid credentials")) {
    return "Check your email and password and try again.";
  }
  if (lower.includes("email not confirmed") || lower.includes("not confirmed")) {
    return "Confirm your email first, then try again.";
  }
  if (lower.includes("already registered") || lower.includes("already been registered")) {
    return "An account with this email already exists. Please sign in instead.";
  }
  if (lower.includes("rate") || lower.includes("too many")) {
    return "Too many attempts. Please wait a moment and try again.";
  }
  if (
    (lower.includes("try again") ||
      lower.includes("sign in instead") ||
      lower.includes("check ")) &&
    !lower.includes("http") &&
    trimmed.length < 180
  ) {
    return trimmed;
  }
  return fallback;
}

