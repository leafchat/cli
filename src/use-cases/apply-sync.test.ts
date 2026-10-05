import { describe, expect, test } from "vitest";
import { err, ok } from "../domain/result.ts";
import type { SyncResponse } from "../domain/sync-contract.ts";
import {
  fakeClock,
  fakeGitHistory,
  fakeSyncApi,
  fakeTree,
} from "../test/fakes.ts";
import {
  apiDocument,
  apiProblem,
  syncPlan,
  syncResponse,
} from "../test/mother.ts";
import { expectErr, expectOk } from "../test/result.ts";
import { applySync } from "./apply-sync.ts";

const PDF_SHA = "2".repeat(64);
const PDF_NEED = {
  sha256: PDF_SHA,
  size: 8,
  content_type: "application/pdf",
  external_ids: ["共通/料金表.pdf"],
};
const MD = { path: "共通/営業時間.md", content: "# 営業時間\n" };
const PDF = { path: "共通/料金表.pdf", content: "%PDF-1.7", sha256: PDF_SHA };

const CREATE_PDF = {
  external_id: "共通/料金表.pdf",
  filename: "料金表.pdf",
  parts: null,
  folder_id: "folder-1",
  folder_name: "共通",
};

/** PDF を 1 つ作り、そのアップロードが要る dry-run。 */
const DRY_RUN_PDF = ok(
  syncResponse({
    plan: syncPlan({ create: [CREATE_PDF] }),
    uploads_required: [PDF_NEED],
  }),
);

const executedRound = (over: Partial<SyncResponse> = {}) =>
  ok(syncResponse({ dry_run: false, ...over }));

const UPLOADED = ok({ sha256: PDF_SHA, size: 8, already_uploaded: false });

/** 既定は「git の履歴なし・確認は「はい」・待たない」。 */
function setup(
  tree: ReturnType<typeof fakeTree>,
  responses: Parameters<typeof fakeSyncApi>[0],
  options: { deletedInGit?: readonly string[] | null; answer?: boolean } = {},
) {
  const api = fakeSyncApi(responses);
  const git = fakeGitHistory(options.deletedInGit ?? null);
  const clock = fakeClock();
  const run = (
    over: Partial<Parameters<typeof applySync>[1]> = {},
  ): ReturnType<typeof applySync> =>
    applySync(
      {
        tree,
        api: api.api,
        git: git.git,
        clock: clock.clock,
        confirm: async () => options.answer ?? true,
        progress: () => {},
      },
      {
        sourceId: "src-1",
        root: "/repo/knowledge",
        client: null,
        named: [],
        confirmDeletedSince: null,
        wait: false,
        waitTimeoutMs: 1_200_000,
        ...over,
      },
    );
  return { api, git, clock, run };
}

const executeCount = (requests: { dryRun: boolean }[]) =>
  requests.filter((r) => !r.dryRun).length;

describe("反映（apply）", () => {
  test("要るファイルだけを上げ、remaining が 0 になるまで実行し、送った版が公開になるまで待つ", async () => {
    const world = setup(fakeTree([MD, PDF]), {
      sync: [
        ok(
          syncResponse({
            plan: syncPlan({
              create: [
                {
                  external_id: "共通/営業時間.md",
                  filename: "営業時間.md",
                  parts: 1,
                  folder_id: "folder-1",
                  folder_name: "共通",
                },
                CREATE_PDF,
              ],
            }),
            uploads_required: [PDF_NEED],
          }),
        ),
        executedRound({
          executed: [
            {
              kind: "create",
              external_id: "共通/営業時間.md",
              document_id: "doc-1",
              revision_id: "rev-1",
            },
          ],
          remaining: 1,
        }),
        executedRound({
          executed: [
            {
              kind: "create",
              external_id: "共通/料金表.pdf",
              document_id: "doc-2",
              revision_id: "rev-2",
            },
          ],
          remaining: 0,
        }),
      ],
      upload: [UPLOADED],
      documents: [
        ok([
          apiDocument(),
          apiDocument({
            id: "doc-2",
            external_id: "共通/料金表.pdf",
            current_revision: {
              id: "rev-2",
              state: "live",
              error_message: null,
            },
            head_revision: { id: "rev-2", state: "live", error_message: null },
          }),
        ]),
      ],
    });

    const result = await world.run({ wait: true });

    const outcome = expectOk(result);
    expect({
      outcome: outcome.outcome,
      readiness: outcome.readiness,
      uploads: world.api.uploads,
      requests: world.api.syncRequests.map((r) => r.dryRun),
    }).toEqual({
      outcome: "applied",
      readiness: {
        live: ["共通/営業時間.md", "共通/料金表.pdf"],
        pending: [],
        failed: [],
      },
      uploads: [
        { sha256: PDF_SHA, contentType: "application/pdf", text: "%PDF-1.7" },
      ],
      requests: [true, false, false],
    });
  });

  const DELETE_LIMIT = err(
    apiProblem({
      code: "delete_limit_exceeded",
      extensions: { planned: 1, cap: 0, unconfirmed: ["共通/旧料金表.pdf"] },
    }),
  );
  const DRY_RUN_DELETE = ok(
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
  );

  test("削除の安全弁に当たったら、git の履歴で消えたファイルを確認済みにしてやり直す", async () => {
    const world = setup(
      fakeTree([MD]),
      { sync: [DELETE_LIMIT, DRY_RUN_DELETE, executedRound()] },
      { deletedInGit: ["共通/旧料金表.pdf"] },
    );

    const result = await world.run({ confirmDeletedSince: "a1b2c3d" });

    expect({
      outcome: expectOk(result).outcome,
      refs: world.git.refs,
      confirmed: world.api.syncRequests.map((r) => r.confirmedDeletes),
    }).toEqual({
      outcome: "applied",
      refs: ["a1b2c3d"],
      confirmed: [[], ["共通/旧料金表.pdf"], ["共通/旧料金表.pdf"]],
    });
  });

  test("削除の安全弁に当たり、git の履歴に無い削除があれば、確かめられなかった削除を挙げて止める", async () => {
    const world = setup(
      fakeTree([MD]),
      { sync: [DELETE_LIMIT] },
      { deletedInGit: [] },
    );

    const result = await world.run({ confirmDeletedSince: "a1b2c3d" });

    expect({
      error: expectErr(result),
      requests: world.api.syncRequests.length,
    }).toEqual({
      error: {
        kind: "unconfirmed_deletes",
        missing: ["共通/旧料金表.pdf"],
        historyUnavailable: false,
      },
      requests: 1,
    });
  });

  const UPLOAD_REQUIRED = err(
    apiProblem({
      code: "upload_required",
      extensions: { uploads: [PDF_NEED] },
    }),
  );

  test("実行で upload_required が返ったら、1 度だけ上げ直して続ける", async () => {
    const world = setup(fakeTree([PDF]), {
      sync: [DRY_RUN_PDF, UPLOAD_REQUIRED, executedRound()],
      upload: [UPLOADED],
    });

    const result = await world.run();

    expect({
      outcome: expectOk(result).outcome,
      uploads: world.api.uploads.length,
    }).toEqual({ outcome: "applied", uploads: 2 });
  });

  test("実行で upload_required が 2 度返ったら止める", async () => {
    const world = setup(fakeTree([PDF]), {
      sync: [DRY_RUN_PDF, UPLOAD_REQUIRED, UPLOAD_REQUIRED],
      upload: [UPLOADED],
    });

    const result = await world.run();

    expect(expectErr(result)).toMatchObject({
      kind: "api_error",
      stage: "execute",
      problem: { code: "upload_required" },
    });
  });

  test("変更が無ければ「変更なし」で終わり、上げも実行もしない", async () => {
    const world = setup(fakeTree([MD]), {
      sync: [ok(syncResponse({ plan: syncPlan({ unchanged: [MD.path] }) }))],
    });

    const result = await world.run();

    expect({
      outcome: expectOk(result).outcome,
      uploads: world.api.uploads.length,
      executes: executeCount(world.api.syncRequests),
    }).toEqual({ outcome: "unchanged", uploads: 0, executes: 0 });
  });

  test("確認で「いいえ」なら declined で終わり、上げも実行もしない", async () => {
    const world = setup(
      fakeTree([PDF]),
      { sync: [DRY_RUN_PDF] },
      { answer: false },
    );

    const result = await world.run();

    expect({
      error: expectErr(result),
      uploads: world.api.uploads.length,
      executes: executeCount(world.api.syncRequests),
    }).toEqual({ error: { kind: "declined" }, uploads: 0, executes: 0 });
  });

  test("remaining が減り続けるあいだは呼び直し、2 回続けて減らなければ too_many_rounds で止まる", async () => {
    const world = setup(fakeTree([PDF]), {
      sync: [
        DRY_RUN_PDF,
        executedRound({ remaining: 5 }),
        executedRound({ remaining: 3 }),
        executedRound({ remaining: 3 }),
        executedRound({ remaining: 3 }),
      ],
      upload: [UPLOADED],
    });

    const result = await world.run();

    expect({
      error: expectErr(result),
      executes: executeCount(world.api.syncRequests),
    }).toEqual({
      error: { kind: "too_many_rounds", remaining: 3 },
      executes: 4,
    });
  });

  test("operation_failed の cause が取り込めない中身なら、呼び直さずに止めて理由を返す", async () => {
    const world = setup(fakeTree([PDF]), {
      sync: [
        DRY_RUN_PDF,
        err(
          apiProblem({
            status: 502,
            code: "operation_failed",
            detail:
              "共通/料金表.pdf は取り込めない中身です（文書が長すぎます）。",
            extensions: { cause: "too_many_parts" },
          }),
        ),
      ],
      upload: [UPLOADED],
    });

    const result = await world.run();

    expect({
      error: expectErr(result),
      executes: executeCount(world.api.syncRequests),
    }).toMatchObject({
      error: {
        kind: "api_error",
        stage: "execute",
        problem: { extensions: { cause: "too_many_parts" } },
      },
      executes: 1,
    });
  });

  test.each([
    {
      label: "取込に失敗した文書があれば ingest_failed",
      head: { id: "rev-2", state: "failed", error_message: "本文を読めません" },
      kind: "ingest_failed",
    },
    {
      label: "時間内に公開にならなければ not_ready",
      head: { id: "rev-2", state: "processing", error_message: null },
      kind: "not_ready",
    },
  ])("$label", async ({ head, kind }) => {
    const world = setup(fakeTree([PDF]), {
      sync: [
        DRY_RUN_PDF,
        executedRound({
          executed: [
            {
              kind: "create",
              external_id: "共通/料金表.pdf",
              document_id: "doc-2",
              revision_id: "rev-2",
            },
          ],
        }),
      ],
      upload: [UPLOADED],
      documents: [
        ok([
          apiDocument({
            id: "doc-2",
            external_id: "共通/料金表.pdf",
            current_revision: null,
            head_revision: head,
          }),
        ]),
      ],
    });

    const result = await world.run({ wait: true, waitTimeoutMs: 30_000 });

    expect(expectErr(result)).toMatchObject({ kind });
  });
});
