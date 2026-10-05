import { describe, expect, test } from "vitest";
import { err, ok } from "../domain/result.ts";
import { fakeClock, fakeSyncApi, fakeTree } from "../test/fakes.ts";
import { apiProblem, syncPlan, syncResponse } from "../test/mother.ts";
import { expectOk } from "../test/result.ts";
import { planSync } from "./plan-sync.ts";

const PDF_SHA = "2".repeat(64);

const run = (
  tree: ReturnType<typeof fakeTree>,
  api: ReturnType<typeof fakeSyncApi>["api"],
) =>
  planSync(
    { tree, api, clock: fakeClock().clock },
    { sourceId: "src-1", client: null },
  );

describe("計画（plan）", () => {
  test("検査のエラーがあれば API を呼ばずに止め、検査の結果を返す", async () => {
    const api = fakeSyncApi({});

    const result = await run(
      fakeTree([{ path: "渋谷店/メニュー/ランチ.pdf", content: "%PDF-1.7" }]),
      api.api,
    );

    expect({ result, requests: api.syncRequests.length }).toEqual({
      result: {
        ok: false,
        error: {
          kind: "local_check_failed",
          findings: [
            {
              code: "path_depth",
              severity: "error",
              path: "渋谷店/メニュー/ランチ.pdf",
              detail: "渋谷店",
            },
          ],
        },
      },
      requests: 0,
    });
  });

  test("UTF-8 として読めないテキストがあれば、API を呼ばずに not_utf8 で止める", async () => {
    const api = fakeSyncApi({});

    const result = await run(
      fakeTree([
        { path: "共通/営業時間.md", content: new Uint8Array([0x23, 0xff]) },
      ]),
      api.api,
    );

    expect({ result, requests: api.syncRequests.length }).toMatchObject({
      result: {
        ok: false,
        error: {
          kind: "local_check_failed",
          findings: [{ code: "not_utf8", path: "共通/営業時間.md" }],
        },
      },
      requests: 0,
    });
  });

  test("サーバーの計画・警告・要るアップロードを PlanView にまとめ、対応しない形式の注意を添える", async () => {
    const response = syncResponse({
      plan: syncPlan({
        create: [
          {
            external_id: "共通/営業時間.md",
            filename: "営業時間.md",
            parts: 1,
            folder_id: "folder-1",
            folder_name: "共通",
          },
          {
            external_id: "共通/料金表.pdf",
            filename: "料金表.pdf",
            parts: null,
            folder_id: "folder-1",
            folder_name: "共通",
          },
        ],
      }),
      warnings: [
        {
          code: "chunk_boundary",
          external_id: "共通/営業時間.md",
          part: 2,
          line: 41,
        },
      ],
      uploads_required: [
        {
          sha256: PDF_SHA,
          size: 8,
          content_type: "application/pdf",
          external_ids: ["共通/料金表.pdf"],
        },
      ],
    });
    const api = fakeSyncApi({ sync: [ok(response)] });

    const result = await run(
      fakeTree([
        { path: "共通/営業時間.md", content: "# 営業時間\n" },
        { path: "共通/料金表.pdf", content: "%PDF-1.7", sha256: PDF_SHA },
        { path: "共通/料金表.xlsx", content: "PK" },
      ]),
      api.api,
    );

    expect(result).toEqual({
      ok: true,
      value: {
        sourceId: "src-1",
        plan: response.plan,
        warnings: response.warnings,
        uploadsRequired: response.uploads_required,
        findings: [
          {
            code: "unsupported_format",
            severity: "warning",
            path: "共通/料金表.xlsx",
            detail: "xlsx",
          },
        ],
        inlineSkipped: [],
        needsConfirmation: [],
      },
    });
  });

  test("削除が安全弁を超えた計画でも、確認済みにした dry-run をやり直して計画を返し、超えた削除に「確認が要る」の印を付ける", async () => {
    const api = fakeSyncApi({
      sync: [
        err(
          apiProblem({
            code: "delete_limit_exceeded",
            extensions: {
              planned: 1,
              cap: 0,
              unconfirmed: ["共通/旧料金表.pdf"],
            },
          }),
        ),
        ok(
          syncResponse({
            plan: syncPlan({
              delete: [
                {
                  external_id: "共通/旧料金表.pdf",
                  document_id: "doc-9",
                  filename: "旧料金表.pdf",
                },
              ],
            }),
          }),
        ),
      ],
    });

    const result = await run(
      fakeTree([{ path: "共通/営業時間.md", content: "# 営業時間\n" }]),
      api.api,
    );

    expect({
      needsConfirmation: expectOk(result).needsConfirmation,
      confirmedDeletes: api.syncRequests.map((r) => r.confirmedDeletes),
    }).toEqual({
      needsConfirmation: ["共通/旧料金表.pdf"],
      confirmedDeletes: [[], ["共通/旧料金表.pdf"]],
    });
  });
});
