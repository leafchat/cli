import type { ApiProblem } from "./sync-contract.ts";

export type RetryCode =
  | "sync_in_progress"
  | "rate_limited"
  | "operation_failed";

export type RetryRule = Readonly<{
  code: RetryCode;
  waitMs: number;
  maxTries: number;
}>;

// Why 30 秒か: 同じソースの同期の排他は 60 秒（leafchat の SOURCE_SYNC_LEASE_MS）。
const SYNC_IN_PROGRESS: RetryRule = {
  code: "sync_in_progress",
  waitMs: 30_000,
  maxTries: 6,
};
// Why 60 秒か: leafchat の 429 は Retry-After を付ける。付いていないときの既定。
const RATE_LIMIT_DEFAULT_WAIT_SECONDS = 60;
const RATE_LIMIT_MAX_TRIES = 6;
// Why 送り直すか: 同じ一式を送ると、leafchat は済んだ操作を除いて続きから実行する。
const OPERATION_FAILED: RetryRule = {
  code: "operation_failed",
  waitMs: 10_000,
  maxTries: 3,
};
// Why この 4 つだけか: ほかの理由（取り込めない中身など）は、送り直しても同じところで止まる。
const RETRYABLE_CAUSES: ReadonlySet<unknown> = new Set([
  "storage_failed",
  "search_unavailable",
  "rate_limited",
  "exception",
]);

export function retryRuleOf(problem: ApiProblem): RetryRule | null {
  if (problem.status === 409 && problem.code === "sync_in_progress") {
    return SYNC_IN_PROGRESS;
  }
  if (problem.status === 429) {
    return {
      code: "rate_limited",
      waitMs:
        (problem.retryAfterSeconds ?? RATE_LIMIT_DEFAULT_WAIT_SECONDS) * 1000,
      maxTries: RATE_LIMIT_MAX_TRIES,
    };
  }
  if (
    problem.status === 502 &&
    problem.code === "operation_failed" &&
    RETRYABLE_CAUSES.has(problem.extensions.cause)
  ) {
    return OPERATION_FAILED;
  }
  return null;
}
