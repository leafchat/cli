import type { PlanView } from "../domain/report.ts";
import { err, ok, type Result } from "../domain/result.ts";
import type { SyncClientInfo } from "../domain/sync-contract.ts";
import type { Clock } from "../infrastructure/clock.ts";
import type { TreeReader } from "../infrastructure/fs-tree.ts";
import type { LeafchatSyncApi } from "../infrastructure/leafchat-api.ts";
import {
  dryRun,
  failureOf,
  prepareFiles,
  type SyncFailure,
  unconfirmedOf,
  viewOf,
} from "./sync-steps.ts";

/**
 * 検査 → 送る一式 → サーバーの計画（dry-run）。
 * Why 削除の安全弁に当たったら確認済みにしてやり直すか: dry-run は文書を書かないので安全。
 * やり直さないと、資料の少ないソースでファイルを消す PR の計画が失敗になり、PR のコメントが出ない。超えた削除には「確認が要る」の印を付ける（反映のときに確かめる）。
 */
export async function planSync(
  deps: { tree: TreeReader; api: LeafchatSyncApi; clock: Clock },
  params: { sourceId: string; client: SyncClientInfo | null },
): Promise<Result<PlanView, SyncFailure>> {
  const prepared = await prepareFiles(deps);
  if (!prepared.ok) return prepared;
  const first = await dryRun(deps, prepared.value, {
    confirmedDeletes: [],
    client: params.client,
  });
  if (first.ok) {
    return ok(viewOf(params.sourceId, prepared.value, first.value, []));
  }
  const failure = first.error;
  if (
    failure.kind !== "problem" ||
    failure.problem.code !== "delete_limit_exceeded"
  ) {
    return err(failureOf(failure, "dry_run"));
  }
  const unconfirmed = unconfirmedOf(failure.problem);
  const second = await dryRun(deps, prepared.value, {
    confirmedDeletes: unconfirmed,
    client: params.client,
  });
  if (!second.ok) return err(failureOf(second.error, "dry_run"));
  return ok(viewOf(params.sourceId, prepared.value, second.value, unconfirmed));
}
