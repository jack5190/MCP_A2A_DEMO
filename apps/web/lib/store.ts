import type { ExecutionResult } from "./types";

/**
 * In-memory execution history. Persists for the lifetime of the running server
 * process (fine for a local demo). Newest executions first.
 */
const history: ExecutionResult[] = [];

export function addExecution(result: ExecutionResult): void {
  history.unshift(result);
  if (history.length > 50) history.pop();
}

export function listExecutions(): ExecutionResult[] {
  return history;
}
