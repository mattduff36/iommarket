const MAX_PASSWORD_ERROR_LENGTH = 400;
const CHARACTERS_PREFIX = "Password should contain at least one character of each: ";
const PWNED_SENTENCE =
  "Password is known to be weak and easy to guess, please choose a different one.";
const LENGTH_SENTENCE = /^Password should be at least \d+ characters\./;
const TOO_LONG_SENTENCE = /^Password cannot be longer than 72 characters\.?$/;
const NEXT_SENTENCE_MARKERS = [
  " Password should be at least ",
  " Password is known to be weak and easy to guess",
  ` ${CHARACTERS_PREFIX}`,
];

const REASON_MESSAGES: Record<string, string> = {
  length: "Password should be longer.",
  characters: "Password should contain at least one character from each required set.",
  pwned: PWNED_SENTENCE,
};

function takeCharactersSentence(rest: string) {
  if (!rest.startsWith(CHARACTERS_PREFIX)) return null;
  let splitAt = -1;
  for (const marker of NEXT_SENTENCE_MARKERS) {
    const index = rest.indexOf(marker, CHARACTERS_PREFIX.length);
    if (index !== -1 && (splitAt === -1 || index < splitAt)) splitAt = index;
  }
  const sentence = (splitAt === -1 ? rest : rest.slice(0, splitAt)).trim();
  const body = sentence.endsWith(".")
    ? sentence.slice(CHARACTERS_PREFIX.length, -1)
    : "";
  if (!body || body.length > 240) return null;
  const approvedSets = new Set([
    "abcdefghijklmnopqrstuvwxyz", "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "0123456789",
    "!@#$%^&*()_+-=[]{};':\"|<>?,./`~",
  ]);
  if (!body.split(", ").every((set) => approvedSets.has(set))) return null;
  return {
    sentence,
    rest: splitAt === -1 ? "" : rest.slice(splitAt).trim(),
  };
}

function splitKnownPasswordSentences(message: string) {
  const seen = new Set<string>();
  const sentences: string[] = [];
  let rest = message;

  while (rest.length > 0) {
    const lengthMatch = rest.match(LENGTH_SENTENCE);
    if (
      lengthMatch &&
      (rest.length === lengthMatch[0].length || rest[lengthMatch[0].length] === " ")
    ) {
      if (seen.has("length")) return null;
      seen.add("length");
      sentences.push(lengthMatch[0]);
      rest = rest.slice(lengthMatch[0].length).trim();
      continue;
    }

    if (
      rest.startsWith(PWNED_SENTENCE) &&
      (rest.length === PWNED_SENTENCE.length || rest[PWNED_SENTENCE.length] === " ")
    ) {
      if (seen.has("pwned")) return null;
      seen.add("pwned");
      sentences.push(PWNED_SENTENCE);
      rest = rest.slice(PWNED_SENTENCE.length).trim();
      continue;
    }

    const characters = takeCharactersSentence(rest);
    if (!characters) return null;
    if (seen.has("characters")) return null;
    seen.add("characters");
    sentences.push(characters.sentence);
    rest = characters.rest;
  }

  return sentences.length > 0 ? sentences : null;
}

export function publicPasswordPolicyMessage(message: string): string | null {
  const trimmed = message.trim();
  if (!trimmed || trimmed.length > MAX_PASSWORD_ERROR_LENGTH) return null;
  if (/[\r\n]/.test(trimmed) || /https?:\/\//i.test(trimmed)) return null;
  if (TOO_LONG_SENTENCE.test(trimmed)) {
    return "Password cannot be longer than 72 characters.";
  }
  const sentences = splitKnownPasswordSentences(trimmed);
  return sentences ? sentences.join(" ") : null;
}

function passwordMessageFromReasons(reasons: readonly string[]) {
  const known = new Set(reasons);
  const messages = ["length", "characters", "pwned"]
    .filter((reason) => known.has(reason))
    .map((reason) => REASON_MESSAGES[reason]);
  return messages.length > 0 ? messages.join(" ") : null;
}

export function supabasePasswordErrorMessage(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const record = error as {
    message?: unknown;
    code?: unknown;
    name?: unknown;
    reasons?: unknown;
  };
  const message = typeof record.message === "string" ? record.message : "";
  const fromMessage = publicPasswordPolicyMessage(message);
  if (fromMessage) return fromMessage;

  const weak =
    record.code === "weak_password" || record.name === "AuthWeakPasswordError";
  if (!weak || !Array.isArray(record.reasons)) return null;
  return passwordMessageFromReasons(
    record.reasons.filter((reason): reason is string => typeof reason === "string"),
  );
}
