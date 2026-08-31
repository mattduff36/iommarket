import { z } from "zod";

export const EMAIL_REQUIRED_MESSAGE = "Enter your email address.";
export const EMAIL_INVALID_MESSAGE =
  "Enter a valid email, for example name@example.com.";

export const emailField = z
  .string()
  .trim()
  .min(1, { error: EMAIL_REQUIRED_MESSAGE, abort: true })
  .email({
    pattern: z.regexes.html5Email,
    error: EMAIL_INVALID_MESSAGE,
  });
