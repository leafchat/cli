import { expect, test } from "vitest";
import { apiDocument } from "../test/mother.ts";
import { evaluateReadiness } from "./readiness.ts";

const EXPECTED = {
  externalId: "共通/営業時間.md",
  documentId: "doc-1",
  revisionId: "rev-2",
};

test.each([
  {
    状況: "文書が無い",
    documents: [],
    readiness: {
      live: [],
      pending: [],
      failed: [
        {
          externalId: "共通/営業時間.md",
          message: "文書が見つかりません（反映の途中で消されました）。",
        },
      ],
    },
  },
  {
    状況: "公開中の版が送った版",
    documents: [
      apiDocument({
        current_revision: { id: "rev-2", state: "live", error_message: null },
        head_revision: { id: "rev-2", state: "live", error_message: null },
      }),
    ],
    readiness: { live: ["共通/営業時間.md"], pending: [], failed: [] },
  },
  {
    状況: "head の版が別の版",
    documents: [
      apiDocument({
        head_revision: { id: "rev-3", state: "queued", error_message: null },
      }),
    ],
    readiness: {
      live: [],
      pending: [],
      failed: [
        {
          externalId: "共通/営業時間.md",
          message: "反映の途中で、別の版に置き換わりました。",
        },
      ],
    },
  },
  {
    状況: "head の版の取り込みが失敗",
    documents: [
      apiDocument({
        head_revision: {
          id: "rev-2",
          state: "failed",
          error_message: "本文を読めません",
        },
      }),
    ],
    readiness: {
      live: [],
      pending: [],
      failed: [
        {
          externalId: "共通/営業時間.md",
          message: "取り込みに失敗しました：本文を読めません",
        },
      ],
    },
  },
  {
    状況: "head の版が処理中",
    documents: [
      apiDocument({
        head_revision: {
          id: "rev-2",
          state: "processing",
          error_message: null,
        },
      }),
    ],
    readiness: { live: [], pending: ["共通/営業時間.md"], failed: [] },
  },
])(
  "送った版の文書が「$状況」なら、表のとおりに判定する",
  ({ documents, readiness }) => {
    const result = evaluateReadiness({ expected: [EXPECTED], documents });

    expect(result).toEqual(readiness);
  },
);

/** 実行の応答を取りこぼした作成（文書と版の ID が分からない）。 */
const EXPECTED_BY_PATH = {
  externalId: "共通/料金表.md",
  documentId: null,
  revisionId: null,
};

test.each([
  {
    状況: "最新の版が公開中",
    documents: [
      apiDocument({
        id: "doc-9",
        external_id: "共通/料金表.md",
        current_revision: { id: "rev-9", state: "live", error_message: null },
        head_revision: { id: "rev-9", state: "live", error_message: null },
      }),
    ],
    readiness: { live: ["共通/料金表.md"], pending: [], failed: [] },
  },
  {
    状況: "最新の版が処理中",
    documents: [
      apiDocument({
        id: "doc-9",
        external_id: "共通/料金表.md",
        current_revision: null,
        head_revision: {
          id: "rev-9",
          state: "processing",
          error_message: null,
        },
      }),
    ],
    readiness: { live: [], pending: ["共通/料金表.md"], failed: [] },
  },
  {
    状況: "最新の版の取り込みが失敗",
    documents: [
      apiDocument({
        id: "doc-9",
        external_id: "共通/料金表.md",
        current_revision: null,
        head_revision: {
          id: "rev-9",
          state: "failed",
          error_message: "本文を読めません",
        },
      }),
    ],
    readiness: {
      live: [],
      pending: [],
      failed: [
        {
          externalId: "共通/料金表.md",
          message: "取り込みに失敗しました：本文を読めません",
        },
      ],
    },
  },
  {
    状況: "外部 ID の文書が無い",
    documents: [apiDocument()],
    readiness: {
      live: [],
      pending: [],
      failed: [
        {
          externalId: "共通/料金表.md",
          message: "文書が見つかりません（反映の途中で消されました）。",
        },
      ],
    },
  },
])(
  "版の分からない操作は外部 ID で文書を探し、「$状況」なら表のとおりに判定する",
  ({ documents, readiness }) => {
    const result = evaluateReadiness({
      expected: [EXPECTED_BY_PATH],
      documents,
    });

    expect(result).toEqual(readiness);
  },
);
