// errors.ts — narrowing helpers for the `unknown` that lands in a catch block.

/** A human-readable message for anything that can be thrown. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return String(err);
}

/**
 * True for the DOMException a file picker throws when the user dismisses it.
 * Cancelling is not an error worth surfacing.
 */
export function isAbort(err: unknown): boolean {
  return err instanceof DOMException ? err.name === 'AbortError' : false;
}
