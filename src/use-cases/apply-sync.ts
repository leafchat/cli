import { decideConfirmedDeletes } from "../domain/deletions.ts";
import {
  type Expected,
  evaluateReadiness,
  type Readiness,
} from "../domain/readiness.ts";
import { hasChanges, type PlanView } from "../domain/report.ts";
import { err, ok, type Result } from "../domain/result.ts";
import type {
  SyncClientInfo,
  SyncExecuted,
  SyncResponse,
  UploadNeed,
} from "../domain/sync-contract.ts";
import type { Clock } from "../infrastructure/clock.ts";
import type { TreeReader } from "../infrastructure/fs-tree.ts";
import type { GitHistory } from "../infrastructure/git-history.ts";
import type { LeafchatSyncApi } from "../infrastructure/leafchat-api.ts";
import {
  dryRun,
  failureOf,
  type Prepared,
  prepareFiles,
  type SyncFailure,
  unconfirmedOf,
  uploadsOf,
  viewOf,
  withRetry,
} from "./sync-steps.ts";

export type ProgressEvent =
  | Readonly<{ kind: "upload"; done: number; total: number }>
  | Readonly<{ kind: "execute"; executed: number; remaining: number }>
  | Readonly<{ kind: "wait"; live: number; pending: number }>;

export type ApplyOutcome = Readonly<{
  outcome: "unchanged" | "applied";
  view: PlanView;
  executed: readonly SyncExecuted[];
  /** 待たなかったときは null。 */
  readiness: Readiness | null;
}>;

type Deps = {
  tree: TreeReader;
  api: LeafchatSyncApi;
  git: GitHistory;
  clock: Clock;
  /** 計画を見せて反映してよいかを聞く（端末なら y/N。--yes なら聞かずに真）。 */
  confirm: (view: PlanView) => Promise<boolean>;
  progress: (event: ProgressEvent) => void;
};

// Why 4 並列か: 1 件 15 MB まで。並べすぎると手元の回線とメモリを使い切り、1 つずつでは 500 件の PDF に時間がかかりすぎる。
const UPLOAD_CONCURRENCY = 4;
// Why 15 秒か: leafchat の取込の照合は毎分。鍵ごとの要求の上限の内に十分に収まる。
const POLL_INTERVAL_MS = 15_000;
// Why 連続 2 回で止めるか: 1 回の実行の原本を読む操作は 10 件までなので、大きなソースでは何十回もかかる。回数の上限ではなく、進まなくなったことで止める。
const MAX_STALLED_ROUNDS = 2;

async function uploadAll(
  deps: Deps,
  prepared: Prepared,
  needs: readonly UploadNeed[],
): Promise<Result<void, SyncFailure>> {
  const state: { next: number; done: number; failure: SyncFailure | null } = {
    next: 0,
    done: 0,
    failure: null,
  };
  const worker = async () => {
    while (state.failure === null) {
      const need = needs[state.next];
      if (need === undefined) return;
      state.next += 1;
      const path = need.external_ids[0] ?? "";
      const bytes = await deps.tree.read(
        prepared.originalPathOf.get(path) ?? path,
      );
      const uploaded = await withRetry(
        deps,
        () =>
          deps.api.upload({
            sha256: need.sha256,
            contentType: need.content_type,
            bytes,
          }),
        "upload",
      );
      if (!uploaded.ok) {
        state.failure ??= failureOf(uploaded.error, "upload");
        return;
      }
      state.done += 1;
      deps.progress({ kind: "upload", done: state.done, total: needs.length });
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(UPLOAD_CONCURRENCY, needs.length) }, worker),
  );
  return state.failure === null ? ok(undefined) : err(state.failure);
}

async function waitUntilLive(
  deps: Deps,
  expected: readonly Expected[],
  timeoutMs: number,
): Promise<Result<Readiness, SyncFailure>> {
  const startedAt = deps.clock.now();
  for (;;) {
    const listed = await deps.api.listDocuments();
    if (!listed.ok) {
      return err({ kind: "api_error", stage: "status", problem: listed.error });
    }
    const readiness = evaluateReadiness({ expected, documents: listed.value });
    deps.progress({
      kind: "wait",
      live: readiness.live.length,
      pending: readiness.pending.length,
    });
    if (readiness.failed.length > 0) {
      return err({ kind: "ingest_failed", readiness });
    }
    if (readiness.pending.length === 0) return ok(readiness);
    if (deps.clock.now() - startedAt >= timeoutMs) {
      return err({ kind: "not_ready", readiness });
    }
    await deps.clock.sleep(POLL_INTERVAL_MS);
  }
}

/** 計画（削除の安全弁に当たれば、確かめた削除だけを確認済みにしてやり直す）。 */
async function planForApply(
  deps: Deps,
  prepared: Prepared,
  params: {
    root: string;
    client: SyncClientInfo | null;
    named: readonly string[];
    confirmDeletedSince: string | null;
  },
): Promise<
  Result<{ response: SyncResponse; confirmed: readonly string[] }, SyncFailure>
> {
  const first = await dryRun(deps, prepared, {
    confirmedDeletes: [],
    client: params.client,
  });
  if (first.ok) return ok({ response: first.value, confirmed: [] });
  const failure = first.error;
  if (
    failure.kind !== "problem" ||
    failure.problem.code !== "delete_limit_exceeded"
  ) {
    return err(failureOf(failure, "dry_run"));
  }
  const deletedInGit =
    params.confirmDeletedSince === null
      ? null
      : await deps.git.deletedSince({
          ref: params.confirmDeletedSince,
          root: params.root,
        });
  const decided = decideConfirmedDeletes({
    unconfirmed: unconfirmedOf(failure.problem),
    named: params.named,
    deletedInGit,
  });
  if (!decided.ok) {
    return err({
      kind: "unconfirmed_deletes",
      missing: decided.error.missing,
      historyUnavailable:
        params.confirmDeletedSince !== null && deletedInGit === null,
    });
  }
  const second = await dryRun(deps, prepared, {
    confirmedDeletes: decided.value,
    client: params.client,
  });
  if (!second.ok) return err(failureOf(second.error, "dry_run"));
  return ok({ response: second.value, confirmed: decided.value });
}

/**
 * 検査 → 計画 → 確認 → 要るファイルのアップロード → 実行（remaining が 0 まで）→ 公開まで待つ。
 * Why 実行の upload_required で 1 度だけ上げ直すか: 予約の期限切れや置き場の掃除との競合で起きうる。2 度目は同じことを繰り返すだけなので止める。
 */
export async function applySync(
  deps: Deps,
  params: {
    sourceId: string;
    root: string;
    client: SyncClientInfo | null;
    named: readonly string[];
    confirmDeletedSince: string | null;
    wait: boolean;
    waitTimeoutMs: number;
  },
): Promise<Result<ApplyOutcome, SyncFailure>> {
  const prepared = await prepareFiles(deps);
  if (!prepared.ok) return prepared;
  const planned = await planForApply(deps, prepared.value, params);
  if (!planned.ok) return planned;
  const { response, confirmed } = planned.value;
  const view = viewOf(params.sourceId, prepared.value, response, []);
  if (!hasChanges(response.plan)) {
    return ok({ outcome: "unchanged", view, executed: [], readiness: null });
  }
  if (!(await deps.confirm(view))) return err({ kind: "declined" });

  const uploaded = await uploadAll(
    deps,
    prepared.value,
    response.uploads_required,
  );
  if (!uploaded.ok) return uploaded;

  const executed: SyncExecuted[] = [];
  let previous = Number.POSITIVE_INFINITY;
  let stalled = 0;
  let reuploaded = false;
  for (;;) {
    const round = await withRetry(
      deps,
      () =>
        deps.api.sync({
          files: prepared.value.files,
          confirmedDeletes: confirmed,
          dryRun: false,
          client: params.client,
        }),
      "execute",
    );
    if (!round.ok) {
      const failure = round.error;
      if (
        failure.kind === "problem" &&
        failure.problem.code === "upload_required" &&
        !reuploaded
      ) {
        reuploaded = true;
        const again = await uploadAll(
          deps,
          prepared.value,
          uploadsOf(failure.problem),
        );
        if (!again.ok) return again;
        continue;
      }
      return err(failureOf(failure, "execute"));
    }
    executed.push(...round.value.executed);
    const { remaining } = round.value;
    deps.progress({ kind: "execute", executed: executed.length, remaining });
    if (remaining === 0) break;
    stalled = remaining < previous ? 0 : stalled + 1;
    if (stalled >= MAX_STALLED_ROUNDS) {
      return err({ kind: "too_many_rounds", remaining });
    }
    previous = remaining;
  }

  if (!params.wait) {
    return ok({ outcome: "applied", view, executed, readiness: null });
  }
  const expected = executed.flatMap((item): Expected[] =>
    (item.kind === "create" ||
      item.kind === "update" ||
      item.kind === "rename") &&
    item.revision_id !== null
      ? [
          {
            externalId: item.external_id,
            documentId: item.document_id,
            revisionId: item.revision_id,
          },
        ]
      : [],
  );
  const readiness =
    expected.length === 0
      ? ok({ live: [], pending: [], failed: [] })
      : await waitUntilLive(deps, expected, params.waitTimeoutMs);
  if (!readiness.ok) return readiness;
  return ok({ outcome: "applied", view, executed, readiness: readiness.value });
}
