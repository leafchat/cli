import type { LocalEntry } from "../domain/local-check.ts";
import type { HashedEntry } from "../domain/manifest.ts";
import type { PlanView } from "../domain/report.ts";
import type {
  ApiDocument,
  ApiProblem,
  SyncPlan,
  SyncResponse,
} from "../domain/sync-contract.ts";

// テスト用の既定値つき工場関数（Object Mother）。値はすべてハードコードし、本番の関数で組み立てない。

const encoder = new TextEncoder();

/** 既定は「共通/営業時間.md・100 バイト・普通のファイル・Markdown の先頭」。 */
export function localEntry(over: Partial<LocalEntry> = {}): LocalEntry {
  const path = over.path ?? "共通/営業時間.md";
  return {
    path,
    originalPath: path,
    size: 100,
    kind: "file",
    head: encoder.encode("# 営業時間\n"),
    ...over,
  };
}

/** 既定は「共通/営業時間.md・Markdown・本文 `# 営業時間\n`（15 バイト）」。 */
export function hashedEntry(over: Partial<HashedEntry> = {}): HashedEntry {
  return {
    ...localEntry({ path: over.path ?? "共通/営業時間.md", size: 15 }),
    mime: "text/markdown",
    sha256: "1".repeat(64),
    text: "# 営業時間\n",
    ...over,
  };
}

/** 既定は「409 sync_in_progress」。 */
export function apiProblem(over: Partial<ApiProblem> = {}): ApiProblem {
  return {
    status: 409,
    code: "sync_in_progress",
    detail: null,
    retryAfterSeconds: null,
    extensions: {},
    ...over,
  };
}

/** 既定は「共通/営業時間.md の文書で、版 rev-1 が公開中」。 */
export function apiDocument(over: Partial<ApiDocument> = {}): ApiDocument {
  return {
    id: "doc-1",
    external_id: "共通/営業時間.md",
    current_revision: { id: "rev-1", state: "live", error_message: null },
    head_revision: { id: "rev-1", state: "live", error_message: null },
    ...over,
  };
}

/** 既定は「何も変えない計画」。 */
export function syncPlan(over: Partial<SyncPlan> = {}): SyncPlan {
  return {
    folders_to_create: [],
    create: [],
    update: [],
    move: [],
    rename: [],
    delete: [],
    unchanged: [],
    unmanaged: [],
    ...over,
  };
}

/** 既定は「ソース src-1 の、何も変えない計画（注意も検査の結果も無い）」。 */
export function planView(over: Partial<PlanView> = {}): PlanView {
  return {
    sourceId: "src-1",
    plan: syncPlan(),
    warnings: [],
    uploadsRequired: [],
    findings: [],
    inlineSkipped: [],
    needsConfirmation: [],
    ...over,
  };
}

/** 既定は「dry-run で、何も変えない計画・警告なし・要るアップロードなし・残り 0」。 */
export function syncResponse(over: Partial<SyncResponse> = {}): SyncResponse {
  return {
    dry_run: true,
    plan: syncPlan(),
    uploads_required: [],
    warnings: [],
    executed: [],
    remaining: 0,
    ...over,
  };
}
