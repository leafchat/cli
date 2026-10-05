import { describe, expect, test } from "vitest";
import { planView, syncPlan } from "../test/mother.ts";
import {
  renderCheckMarkdown,
  renderPlanMarkdown,
  renderPlanText,
} from "./report.ts";
import type { SyncWarning } from "./sync-contract.ts";

/** 作成・更新・名前の変更・削除・作るフォルダ・2 種類の警告・要るアップロードを持つ計画。 */
const BUSY = planView({
  plan: syncPlan({
    folders_to_create: [{ name: "新宿店", similar_to: "新宿 店" }],
    create: [
      {
        external_id: "新宿店/営業時間.md",
        filename: "営業時間.md",
        parts: 1,
        folder_id: null,
        folder_name: "新宿店",
      },
    ],
    update: [
      {
        external_id: "共通/料金表.pdf",
        document_id: "doc-2",
        filename: "料金表.pdf",
        parts: null,
        to_folder_id: null,
        to_folder_name: null,
      },
    ],
    rename: [
      {
        from_external_id: "渋谷店/営業時間.md",
        external_id: "渋谷店/営業時間のご案内.md",
        document_id: "doc-3",
        filename: "営業時間のご案内.md",
        to_folder_id: null,
        to_folder_name: null,
      },
    ],
    delete: [
      {
        external_id: "渋谷店/旧メニュー.pdf",
        document_id: "doc-4",
        filename: "旧メニュー.pdf",
      },
    ],
    unchanged: ["共通/会社概要.md"],
  }),
  warnings: [
    {
      code: "chunk_boundary",
      external_id: "渋谷店/営業時間のご案内.md",
      part: 2,
      line: 41,
    },
    {
      code: "same_filename_across_folders",
      external_ids: ["新宿店/営業時間.md", "渋谷店/営業時間.md"],
      filename: "営業時間.md",
    },
  ],
  uploadsRequired: [
    {
      sha256: "2".repeat(64),
      size: 3_565_158,
      content_type: "application/pdf",
      external_ids: ["共通/料金表.pdf"],
    },
  ],
});

describe("計画の表示", () => {
  test.each([
    { label: "件数の表の作成", core: "作成              1" },
    { label: "件数の表の変更なし", core: "変更なし          1" },
    { label: "作るフォルダの件数と名前", core: "フォルダの作成    1   新宿店" },
    {
      label: "アップロードの件数と大きさ",
      core: "アップロード      1 件（3.4 MB）",
    },
    { label: "作成の行", core: "+ 作成        新宿店/営業時間.md" },
    { label: "更新の行", core: "~ 更新        共通/料金表.pdf" },
    {
      label: "名前の変更の矢印",
      core: "> 名前の変更  渋谷店/営業時間.md → 渋谷店/営業時間のご案内.md",
    },
    { label: "削除の行", core: "- 削除        渋谷店/旧メニュー.pdf" },
    {
      label: "チャンク境界の警告",
      core: "! 渋谷店/営業時間のご案内.md：2 つ目の部分が節の途中から始まります（41 行目）。",
    },
    {
      label: "同じファイル名の警告",
      core: "! 「営業時間.md」が 2 つのフォルダ（新宿店・渋谷店）にあります。",
    },
    {
      label: "削除と作成が同時にあるときの注意",
      core: "i 削除と作成が同時にあります。名前と中身を同じ同期で変えると、文書の履歴が切れます",
    },
    {
      label: "作るフォルダと似た名前",
      core: "i フォルダ「新宿店」を作ります（似た名前の「新宿 店」があります）。",
    },
  ])("計画のテキストに $label が出る", ({ core }) => {
    const text = renderPlanText(BUSY);

    expect(text).toContain(core);
  });

  test("変更が無ければ「変更はありません」だけが出る", () => {
    const text = renderPlanText(
      planView({ plan: syncPlan({ unchanged: ["共通/会社概要.md"] }) }),
    );

    expect(text).toBe(
      "leafchat の同期の計画  ソース src-1\n\n  変更はありません。\n",
    );
  });

  test.each([
    {
      label: "削除の行に「（確認が要る）」",
      core: "- 削除        渋谷店/旧メニュー.pdf（確認が要る）",
    },
    {
      label: "注意に確認のしかた",
      core: "! 一度に消す資料が多いため、反映のときに確認が要ります（--confirm-delete か、push の前後の git の履歴で消えたファイル）。",
    },
  ])("確認が要る削除があると、$label が出る", ({ core }) => {
    const text = renderPlanText(
      planView({
        plan: syncPlan({
          delete: [
            {
              external_id: "渋谷店/旧メニュー.pdf",
              document_id: "doc-4",
              filename: "旧メニュー.pdf",
            },
          ],
        }),
        needsConfirmation: ["渋谷店/旧メニュー.pdf"],
      }),
    );

    expect(text).toContain(core);
  });
});

const CREATE_A = {
  external_id: "共通/a.md",
  filename: "a.md",
  parts: 2,
  folder_id: "folder-1",
  folder_name: "共通",
};

const BOUNDARY_A: SyncWarning = {
  code: "chunk_boundary",
  external_id: "共通/a.md",
  part: 2,
  line: 3,
};

/** 1 件ずつの行を 1 つだけ残す文字数（下の期待する Markdown の長さ）。 */
const MAX_CHARS_FOR_ONE_LINE = 405;

describe("計画の Markdown", () => {
  test.each([
    { label: "件数の表", core: "| 作成 | 1 |" },
    {
      label: "アップロードの件数と大きさ",
      core: "| アップロード | 1 件（3.4 MB） |",
    },
    {
      label: "1 件ずつの行（コードのブロックの中）",
      core: "```text\n+ 作成        新宿店/営業時間.md\n",
    },
    {
      label: "注意（コードのブロックの中）",
      core: "! 渋谷店/営業時間のご案内.md：2 つ目の部分が節の途中から始まります（41 行目）。",
    },
  ])("計画の Markdown に $label が出る", ({ core }) => {
    const markdown = renderPlanMarkdown(BUSY);

    expect(markdown).toContain(core);
  });

  test("パスにバッククォートが 3 つ続いても、コードのブロックを閉じさせない", () => {
    const markdown = renderPlanMarkdown(
      planView({
        plan: syncPlan({
          create: [
            {
              external_id: "共通/a```b.md",
              filename: "a```b.md",
              parts: 1,
              folder_id: null,
              folder_name: "共通",
            },
          ],
        }),
      }),
    );

    expect(markdown).toContain("````text\n+ 作成        共通/a```b.md\n````");
  });

  test("変更が無ければ「変更はありません」だけが出る", () => {
    const markdown = renderPlanMarkdown(planView());

    expect(markdown).toBe(
      "### leafchat の同期の計画（ソース src-1）\n\n変更はありません。\n",
    );
  });

  test("件数の表 → 注意 → 1 件ずつ（折りたたみ）の順に並べ、削除の行を太字にし、見出しの下にフォルダ・時刻・版を出す", () => {
    const markdown = renderPlanMarkdown(
      planView({
        plan: syncPlan({
          create: [CREATE_A],
          delete: [
            {
              external_id: "共通/旧料金表.pdf",
              document_id: "doc-9",
              filename: "旧料金表.pdf",
            },
          ],
        }),
        warnings: [BOUNDARY_A],
      }),
      {
        context: {
          folder: "knowledge",
          generatedAt: "2026-10-05T03:04:05.678Z",
          version: "1.0.0",
        },
      },
    );

    expect(markdown).toBe(
      [
        "### leafchat の同期の計画（ソース src-1）",
        "",
        "フォルダ `knowledge`・2026-10-05 03:04 UTC・leafchat-cli 1.0.0",
        "",
        "| 操作 | 件数 |",
        "| --- | ---: |",
        "| フォルダの作成 | 0 |",
        "| 作成 | 1 |",
        "| 更新 | 0 |",
        "| 名前の変更 | 0 |",
        "| 移動 | 0 |",
        "| **削除** | **1** |",
        "| 変更なし | 0 |",
        "| アップロード | 0 件 |",
        "",
        "**注意**",
        "",
        "```text",
        "! 共通/a.md：2 つ目の部分が節の途中から始まります（3 行目）。見出しの前で切れるよう、節を短くしてください。",
        "i 削除と作成が同時にあります。名前と中身を同じ同期で変えると、文書の履歴が切れます（名前の変更と中身の変更を別々の同期に分ければ保てます）。",
        "```",
        "",
        "<details>",
        "<summary>1 件ずつ（2 件）</summary>",
        "",
        "```text",
        "+ 作成        共通/a.md",
        "- 削除        共通/旧料金表.pdf",
        "```",
        "",
        "</details>",
        "",
      ].join("\n"),
    );
  });

  test("maxChars を超える計画は、件数の表と注意を残して 1 件ずつの行を後ろから落とし、残りの件数と要約への案内を足す", () => {
    const markdown = renderPlanMarkdown(
      planView({
        plan: syncPlan({
          create: [
            CREATE_A,
            { ...CREATE_A, external_id: "共通/b.md", filename: "b.md" },
            { ...CREATE_A, external_id: "共通/c.md", filename: "c.md" },
            { ...CREATE_A, external_id: "共通/d.md", filename: "d.md" },
            { ...CREATE_A, external_id: "共通/e.md", filename: "e.md" },
            { ...CREATE_A, external_id: "共通/f.md", filename: "f.md" },
          ],
        }),
        warnings: [BOUNDARY_A],
      }),
      {
        maxChars: MAX_CHARS_FOR_ONE_LINE,
        omitted: (count) =>
          `ほかに ${count} 件。すべてはジョブの要約を見てください：https://github.com/acme/handbook/actions/runs/1`,
      },
    );

    expect(markdown).toBe(
      [
        "### leafchat の同期の計画（ソース src-1）",
        "",
        "| 操作 | 件数 |",
        "| --- | ---: |",
        "| フォルダの作成 | 0 |",
        "| 作成 | 6 |",
        "| 更新 | 0 |",
        "| 名前の変更 | 0 |",
        "| 移動 | 0 |",
        "| 削除 | 0 |",
        "| 変更なし | 0 |",
        "| アップロード | 0 件 |",
        "",
        "**注意**",
        "",
        "```text",
        "! 共通/a.md：2 つ目の部分が節の途中から始まります（3 行目）。見出しの前で切れるよう、節を短くしてください。",
        "```",
        "",
        "<details>",
        "<summary>1 件ずつ（6 件）</summary>",
        "",
        "```text",
        "+ 作成        共通/a.md",
        "```",
        "",
        "</details>",
        "",
        "ほかに 5 件。すべてはジョブの要約を見てください：https://github.com/acme/handbook/actions/runs/1",
        "",
      ].join("\n"),
    );
  });
});

describe("送る前の検査の Markdown", () => {
  test("検査に落とした理由と、エラーと注意の件数と、1 件ずつの行を出す", () => {
    const markdown = renderCheckMarkdown(
      {
        fileCount: 2,
        findings: [
          {
            code: "path_depth",
            severity: "error",
            path: "渋谷店/メニュー/ランチ.pdf",
            detail: "渋谷店",
          },
          {
            code: "unsupported_format",
            severity: "warning",
            path: "共通/写真.png",
            detail: "png",
          },
        ],
      },
      { notice: "サーバーの計画を省きました。" },
    );

    expect(markdown).toBe(
      [
        "### leafchat の送る前の検査",
        "",
        "サーバーの計画を省きました。",
        "",
        "エラーが 1 件、注意が 1 件あります。エラーを直してから、もう一度実行してください。",
        "",
        "```text",
        "x 渋谷店/メニュー/ランチ.pdf：フォルダは 1 階層までです。「渋谷店」の直下へ移してください。",
        "! 共通/写真.png：対応しない形式（.png）のため送りません。対応する形式は md・txt・json・html・csv・pdf・docx です。",
        "```",
        "",
      ].join("\n"),
    );
  });
});
