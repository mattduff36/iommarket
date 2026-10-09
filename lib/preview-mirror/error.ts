const SECRET = /postgres(?:ql)?:\/\/\S+|Bearer\s+\S+/gi;

export class PreviewMirrorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PreviewMirrorError";
  }
}

export function publicMirrorError(error: unknown): string {
  const message = error instanceof PreviewMirrorError
    ? error.message
    : "The preview refresh could not be confirmed. Reload the page and check its status before retrying.";
  return message.replace(SECRET, "[redacted]").slice(0, 500);
}
