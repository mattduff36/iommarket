export class ListingLifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ListingLifecycleError";
  }
}

export class ListingLifecycleConflictError extends ListingLifecycleError {
  constructor(message = "Listing status changed. Refresh and try again.") {
    super(message);
    this.name = "ListingLifecycleConflictError";
  }
}

export class ListingRevisionConflictError extends Error {
  constructor(message = "Listing revision changed. Refresh and try again.") {
    super(message);
    this.name = "ListingRevisionConflictError";
  }
}

export function isListingConflictError(error: unknown): boolean {
  return (
    error instanceof ListingLifecycleConflictError ||
    error instanceof ListingRevisionConflictError ||
    (error instanceof Error &&
      (error.name === "ListingLifecycleConflictError" ||
        error.name === "ListingRevisionConflictError"))
  );
}

export function isListingLifecycleDomainError(error: unknown): error is Error {
  return (
    error instanceof ListingLifecycleError ||
    (error instanceof Error &&
      (error.name === "ListingLifecycleError" ||
        error.name === "ListingLifecycleConflictError"))
  );
}
