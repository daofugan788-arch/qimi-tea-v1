export class RetryPolicy {
  shouldRetry(task) {
    return task.attempts <= task.maxRetries;
  }

  nextRunAt(task, now = Date.now()) {
    const multiplier = Math.max(1, task.attempts);
    return new Date(now + task.retryDelayMs * multiplier).toISOString();
  }
}
