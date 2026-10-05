import { expect, test } from "vitest";
import { apiProblem } from "../test/mother.ts";
import { retryRuleOf } from "./retry.ts";

const operationFailed = (cause: string) =>
  apiProblem({ status: 502, code: "operation_failed", extensions: { cause } });

test.each([
  {
    label: "409 sync_in_progress",
    problem: apiProblem(),
    rule: { code: "sync_in_progress", waitMs: 30_000, maxTries: 6 },
  },
  {
    label: "429（Retry-After 15 秒）",
    problem: apiProblem({
      status: 429,
      code: "rate_limited",
      retryAfterSeconds: 15,
    }),
    rule: { code: "rate_limited", waitMs: 15_000, maxTries: 6 },
  },
  {
    label: "429（Retry-After なし）",
    problem: apiProblem({ status: 429, code: "rate_limited" }),
    rule: { code: "rate_limited", waitMs: 60_000, maxTries: 6 },
  },
  {
    label: "502 operation_failed（storage_failed）",
    problem: operationFailed("storage_failed"),
    rule: { code: "operation_failed", waitMs: 10_000, maxTries: 3 },
  },
  {
    label: "502 operation_failed（search_unavailable）",
    problem: operationFailed("search_unavailable"),
    rule: { code: "operation_failed", waitMs: 10_000, maxTries: 3 },
  },
  {
    label: "502 operation_failed（rate_limited）",
    problem: operationFailed("rate_limited"),
    rule: { code: "operation_failed", waitMs: 10_000, maxTries: 3 },
  },
  {
    label: "502 operation_failed（exception）",
    problem: operationFailed("exception"),
    rule: { code: "operation_failed", waitMs: 10_000, maxTries: 3 },
  },
  {
    label: "502 operation_failed（取り込めない中身の too_many_parts）",
    problem: operationFailed("too_many_parts"),
    rule: null,
  },
  {
    label: "502 operation_failed（cause なし）",
    problem: apiProblem({ status: 502, code: "operation_failed" }),
    rule: null,
  },
  {
    label: "409 delete_limit_exceeded",
    problem: apiProblem({ code: "delete_limit_exceeded" }),
    rule: null,
  },
])("再試行の規則（$label）", ({ problem, rule }) => {
  const result = retryRuleOf(problem);

  expect(result).toEqual(rule);
});
