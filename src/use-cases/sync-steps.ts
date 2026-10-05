import { isTextMime } from "../domain/formats.ts";
import {
  type CheckedEntry,
  compareFindings,
  type Finding,
} from "../domain/local-check.ts";
import { buildFiles, type HashedEntry, readText } from "../domain/manifest.ts";
import type { Readiness } from "../domain/readiness.ts";
import type { PlanView } from "../domain/report.ts";
import { err, ok, type Result } from "../domain/result.ts";
import { type RetryCode, retryRuleOf } from "../domain/retry.ts";
import type {
  ApiProblem,
  SyncClientInfo,
  SyncFile,
  SyncResponse,
  UploadNeed,
} from "../domain/sync-contract.ts";
import type { Clock } from "../infrastructure/clock.ts";
import type { TreeReader } from "../infrastructure/fs-tree.ts";
import type {
  ApiResult,
  LeafchatSyncApi,
} from "../infrastructure/leafchat-api.ts";
import { checkTree } from "./check-tree.ts";

export type Stage = "dry_run" | "upload" | "execute" | "status";

export type SyncFailure =
  | Readonly<{ kind: "local_check_failed"; findings: readonly Finding[] }>
  | Readonly<{
      kind: "unconfirmed_deletes";
      missing: readonly string[];
      /** --confirm-deleted-since を指定したのに、git の履歴を読めなかったか。 */
      historyUnavailable: boolean;
    }>
  | Readonly<{ kind: "api_error"; stage: Stage; problem: ApiProblem }>
  | Readonly<{ kind: "gave_up"; stage: Stage; code: RetryCode }>
  | Readonly<{ kind: "too_many_rounds"; remaining: number }>
  | Readonly<{ kind: "ingest_failed"; readiness: Readiness }>
  | Readonly<{ kind: "not_ready"; readiness: Readiness }>
  | Readonly<{ kind: "declined" }>;

export type Prepared = Readonly<{
  files: readonly SyncFile[];
  inlineSkipped: readonly string[];
  /** 止めずに知らせる検査の結果（対応しない形式など）。 */
  findings: readonly Finding[];
  /** 送るパス（NFC）→ ファイルシステムの元の名前。 */
  originalPathOf: ReadonlyMap<string, string>;
}>;

/** 検査 → ハッシュと本文 → 送る一式。検査のエラーがあれば API を呼ぶ前に止める。 */
export async function prepareFiles(deps: {
  tree: TreeReader;
}): Promise<Result<Prepared, SyncFailure>> {
  const checked = await checkTree(deps);
  if (checked.findings.some((f) => f.severity === "error")) {
    return err({ kind: "local_check_failed", findings: checked.findings });
  }
  const hashed: HashedEntry[] = [];
  const notUtf8: Finding[] = [];
  for (const file of checked.files) {
    const text = await textOf(deps.tree, file);
    if (text === undefined) {
      notUtf8.push({
        code: "not_utf8",
        severity: "error",
        path: file.path,
        detail: null,
      });
      continue;
    }
    hashed.push({
      ...file,
      sha256: await deps.tree.sha256(file.originalPath),
      text,
    });
  }
  if (notUtf8.length > 0) {
    return err({
      kind: "local_check_failed",
      findings: [...checked.findings, ...notUtf8].toSorted(compareFindings),
    });
  }
  const { files, inlineSkipped } = buildFiles(hashed);
  return ok({
    files,
    inlineSkipped,
    findings: checked.findings,
    originalPathOf: new Map(checked.files.map((f) => [f.path, f.originalPath])),
  });
}

/** テキストなら本文、テキストでなければ null。UTF-8 として読めないテキストは undefined。 */
async function textOf(
  tree: TreeReader,
  file: CheckedEntry,
): Promise<string | null | undefined> {
  if (!isTextMime(file.mime)) return null;
  return readText(await tree.read(file.originalPath)) ?? undefined;
}

type Problem = Readonly<{ kind: "problem"; problem: ApiProblem }>;

/** 再試行の規則（retry.ts）に従って呼び直す。規則の外の誤りは problem で返す。 */
export async function withRetry<T>(
  deps: { clock: Clock },
  call: () => Promise<ApiResult<T>>,
  stage: Stage,
): Promise<Result<T, SyncFailure | Problem>> {
  const tries: Record<RetryCode, number> = {
    sync_in_progress: 0,
    rate_limited: 0,
    operation_failed: 0,
  };
  for (;;) {
    const result = await call();
    if (result.ok) return result;
    const rule = retryRuleOf(result.error);
    if (rule === null) return err({ kind: "problem", problem: result.error });
    tries[rule.code] += 1;
    if (tries[rule.code] >= rule.maxTries) {
      return err({ kind: "gave_up", stage, code: rule.code });
    }
    await deps.clock.sleep(rule.waitMs);
  }
}

export const failureOf = (
  error: SyncFailure | Problem,
  stage: Stage,
): SyncFailure =>
  error.kind === "problem"
    ? { kind: "api_error", stage, problem: error.problem }
    : error;

export function dryRun(
  deps: { api: LeafchatSyncApi; clock: Clock },
  prepared: Prepared,
  params: {
    confirmedDeletes: readonly string[];
    client: SyncClientInfo | null;
  },
): Promise<Result<SyncResponse, SyncFailure | Problem>> {
  return withRetry(
    deps,
    () =>
      deps.api.sync({
        files: prepared.files,
        confirmedDeletes: params.confirmedDeletes,
        dryRun: true,
        client: params.client,
      }),
    "dry_run",
  );
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** delete_limit_exceeded の、確認されていない削除（extensions.unconfirmed）。 */
export const unconfirmedOf = (problem: ApiProblem): string[] => {
  const value = problem.extensions.unconfirmed;
  return isStringArray(value) ? value : [];
};

/** upload_required の、まだ受け取っていないファイル（extensions.uploads）。 */
export const uploadsOf = (problem: ApiProblem): UploadNeed[] => {
  const value = problem.extensions.uploads;
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): UploadNeed[] =>
    isRecord(item) &&
    typeof item.sha256 === "string" &&
    typeof item.size === "number" &&
    typeof item.content_type === "string" &&
    isStringArray(item.external_ids)
      ? [
          {
            sha256: item.sha256,
            size: item.size,
            content_type: item.content_type,
            external_ids: item.external_ids,
          },
        ]
      : [],
  );
};

export const viewOf = (
  sourceId: string,
  prepared: Prepared,
  response: SyncResponse,
  needsConfirmation: readonly string[],
): PlanView => ({
  sourceId,
  plan: response.plan,
  warnings: response.warnings,
  uploadsRequired: response.uploads_required,
  findings: prepared.findings,
  inlineSkipped: prepared.inlineSkipped,
  needsConfirmation,
});
