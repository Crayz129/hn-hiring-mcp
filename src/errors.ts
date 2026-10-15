export type ErrorCode = "INVALID_INPUT" | "NOT_FOUND" | "UPSTREAM_ERROR";

/** An error whose message is safe and useful to show to the model. */
export class HnHiringError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "HnHiringError";
  }
}
