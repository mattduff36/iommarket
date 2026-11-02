/** A source explicitly refused or removed a photo; other failures stay fatal. */
export class RemoteImageUnavailableError extends Error {
  constructor(readonly status: 403 | 404 | 410) {
    super(`Source photo unavailable (${status}).`);
    this.name = "RemoteImageUnavailableError";
  }
}
