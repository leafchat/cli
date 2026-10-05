import {
  type CheckedEntry,
  checkLocalEntries,
  type Finding,
} from "../domain/local-check.ts";
import type { TreeReader } from "../infrastructure/fs-tree.ts";

/** 走査 → 送る前の検査。送る対象と検査の結果を返す。 */
export async function checkTree(deps: {
  tree: Pick<TreeReader, "list">;
}): Promise<{ files: CheckedEntry[]; findings: Finding[] }> {
  const listing = await deps.tree.list();
  return checkLocalEntries(listing.entries, { truncated: listing.truncated });
}
