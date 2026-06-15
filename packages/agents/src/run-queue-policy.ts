export class PermanentAgentRunError extends Error {}

export function runFailureTransition(input: {
  attempts: number;
  maxAttempts: number;
  permanent: boolean;
  now: Date;
}) {
  const shouldRetry = !input.permanent && input.attempts < input.maxAttempts;
  const retryDelayMs = shouldRetry
    ? Math.min(5 * 60 * 1000, 5000 * 2 ** (input.attempts - 1))
    : 0;

  return {
    shouldRetry,
    status: shouldRetry ? "Retrying" : "DeadLettered",
    retryDelayMs,
    runAfter: shouldRetry
      ? new Date(input.now.getTime() + retryDelayMs)
      : input.now,
    completedAt: shouldRetry ? null : input.now,
  } as const;
}
