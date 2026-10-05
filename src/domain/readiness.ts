import type { ApiDocument } from "./sync-contract.ts";

export type Expected = Readonly<{
  externalId: string;
  documentId: string;
  revisionId: string;
}>;

export type Readiness = {
  live: string[];
  pending: string[];
  failed: { externalId: string; message: string }[];
};

// Why current_revision で公開を判定するか: leafchat は、取り込みが済んだ版を current_revision にする。head が先に進んでも、公開中の版は変わらない。
export function evaluateReadiness(input: {
  expected: readonly Expected[];
  documents: readonly ApiDocument[];
}): Readiness {
  const byId = new Map(input.documents.map((doc) => [doc.id, doc]));
  const readiness: Readiness = { live: [], pending: [], failed: [] };
  for (const { externalId, documentId, revisionId } of input.expected) {
    const doc = byId.get(documentId);
    if (doc === undefined) {
      readiness.failed.push({
        externalId,
        message: "文書が見つかりません（反映の途中で消されました）。",
      });
    } else if (doc.current_revision?.id === revisionId) {
      readiness.live.push(externalId);
    } else if (doc.head_revision?.id !== revisionId) {
      readiness.failed.push({
        externalId,
        message: "反映の途中で、別の版に置き換わりました。",
      });
    } else if (doc.head_revision.state === "failed") {
      readiness.failed.push({
        externalId,
        message: `取り込みに失敗しました：${doc.head_revision.error_message ?? "理由は記録されていません"}`,
      });
    } else {
      readiness.pending.push(externalId);
    }
  }
  return readiness;
}
