import { ascending } from "./order.ts";
import { err, ok, type Result } from "./result.ts";

/**
 * 削除の安全弁（サーバーの delete_limit_exceeded）に当たったとき、確認済みにしてよい削除を決める。
 * 確認済みにするのは、(a) --confirm-delete で名指しされたもの、(b) --confirm-deleted-since の git の履歴で消されたもの、だけ。
 * Why 1 つでも確かめられなければ止めるか: 推測で消さない（パスの設定の誤りで一式が欠けると、大量の削除になる）。
 */
export function decideConfirmedDeletes(params: {
  unconfirmed: readonly string[];
  named: readonly string[];
  deletedInGit: readonly string[] | null;
}): Result<string[], { missing: string[] }> {
  const confirmed = new Set([...params.named, ...(params.deletedInGit ?? [])]);
  const missing = params.unconfirmed.filter((path) => !confirmed.has(path));
  if (missing.length > 0) {
    return err({ missing: missing.toSorted(ascending) });
  }
  return ok([...params.unconfirmed].toSorted(ascending));
}
