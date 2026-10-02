import { z } from "zod";

export const PROFILE_NAME_REQUIRED_MESSAGE =
  "Enter a name of at least 2 characters.";

export const profileNameSchema = z.preprocess(
  (value) => (typeof value === "string" ? value : ""),
  z
    .string()
    .trim()
    .min(2, PROFILE_NAME_REQUIRED_MESSAGE)
    .max(100, "Name must be under 100 characters."),
);
