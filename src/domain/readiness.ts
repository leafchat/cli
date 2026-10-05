import type { ApiDocument } from "./sync-contract.ts";

export type Expected = Readonly<{
  externalId: string;
  /** 実行の応答で分かった文書の ID。作成で応答を取りこぼしたときは null（外部 ID で探す）。 */
  documentId: string | null;
  /** 実行の応答で分かった版の ID。応答を取りこぼしたときは null（最新の版で判定する）。 */
  revisionId: string | null;
}>;

export type Readiness = {
  live: string[];
  pending: string[];
  failed: { externalId: string; message: string }[];
};

const NOT_FOUND = "文書が見つかりません（反映の途中で消されました）。";

const failedText = (doc: ApiDocument) =>
  `取り込みに失敗しました：${doc.head_revision?.error_message ?? "理由は記録されていません"}`;

/**
 * Why current_revision で公開を判定するか: leafchat は、取り込みが済んだ版を current_revision にする。head が先に進んでも、公開中の版は変わらない。
 * Why 版の分からない操作を最新の版で判定するか: 実行の応答を取りこぼして呼び直すと、前の呼び出しで済んだ操作の版の ID は届かない。
 * 待ち合わせは実行がすべて済んだ後なので、最新の版（head）がこの同期の版か、それより新しい版になっている。
 */
export function evaluateReadiness(input: {
  expected: readonly Expected[];
  documents: readonly ApiDocument[];
}): Readiness {
  const byId = new Map(input.documents.map((doc) => [doc.id, doc]));
  const byExternalId = new Map(
    input.documents.flatMap((doc): [string, ApiDocument][] =>
      doc.external_id === null ? [] : [[doc.external_id, doc]],
    ),
  );
  const readiness: Readiness = { live: [], pending: [], failed: [] };
  for (const { externalId, documentId, revisionId } of input.expected) {
    const doc =
      documentId === null ? byExternalId.get(externalId) : byId.get(documentId);
    if (doc === undefined) {
      readiness.failed.push({ externalId, message: NOT_FOUND });
    } else if (revisionId === null) {
      const head = doc.head_revision;
      if (head?.state === "failed") {
        readiness.failed.push({ externalId, message: failedText(doc) });
      } else if (head !== null && doc.current_revision?.id === head.id) {
        readiness.live.push(externalId);
      } else {
        readiness.pending.push(externalId);
      }
    } else if (doc.current_revision?.id === revisionId) {
      readiness.live.push(externalId);
    } else if (doc.head_revision?.id !== revisionId) {
      readiness.failed.push({
        externalId,
        message: "反映の途中で、別の版に置き換わりました。",
      });
    } else if (doc.head_revision.state === "failed") {
      readiness.failed.push({ externalId, message: failedText(doc) });
    } else {
      readiness.pending.push(externalId);
    }
  }
  return readiness;
}
