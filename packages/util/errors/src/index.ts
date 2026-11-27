/**
 * Responsibilities: Define the base error type shared by every game-agent package.
 * Contracts: Each error carries a stable machine-readable `code` separate from its human-readable message and supports `cause` chaining.
 * Constraints: Callers route on `code`, never on message text.
 */

/**
 * Base class for game-agent errors.
 * `name` defaults to the concrete subclass name so logs and traces keep the failure class.
 */
export class GameAgentError extends Error {
  /** Stable failure class such as `INVALID_TREE` or `QUOTA_EXHAUSTED`. */
  readonly code: string

  /**
   * @param message - human-readable description.
   * @param code - stable machine-readable failure class.
   * @param options - standard error options, including `cause`.
   */
  constructor(message: string, code: string, options?: ErrorOptions) {
    super(message, options)
    this.code = code
    this.name = new.target.name
  }
}
