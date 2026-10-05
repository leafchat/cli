import { describe, expect, test } from "vitest";
import { ok } from "../domain/result.ts";
import type { SyncResponse } from "../domain/sync-contract.ts";
import {
  fakeClock,
  fakeGitHistory,
  fakePrComments,
  fakeRealpath,
  fakeSyncApi,
  fakeTree,
  fakeWorkflow,
} from "../test/fakes.ts";
import { syncPlan, syncResponse } from "../test/mother.ts";
import { type ActionIo, runAction } from "./main.ts";

const KEY = `lck_${"A".repeat(43)}`;
const WORKSPACE = "/home/runner/work/handbook/handbook";
const PLAN_FILE = "/home/runner/work/_temp/leafchat-1a2b/plan.json";
const MD = { path: "共通/営業時間.md", content: "# 営業時間\n" };

const pullRequest = (headRepo: string) => ({
  pull_request: {
    number: 7,
    head: { repo: { full_name: headRepo } },
    base: { repo: { full_name: "acme/handbook" } },
  },
});

const SAME_REPO_PR = pullRequest("acme/handbook");
const FORK_PR = pullRequest("someone/handbook");

const CREATE_ONE = syncResponse({
  plan: syncPlan({
    create: [
      {
        external_id: "共通/営業時間.md",
        filename: "営業時間.md",
        parts: 1,
        folder_id: "folder-1",
        folder_name: "共通",
      },
    ],
  }),
});

/** 既定は「plan・鍵とソースの ID あり・Markdown 1 件のフォルダ・サーバーは何も変えない計画を返す」。 */
function setup(options: {
  event: string;
  payload: unknown;
  inputs?: Readonly<Record<string, string>>;
  tree?: Parameters<typeof fakeTree>[0];
  sync?: readonly SyncResponse[];
  commentError?: Error;
}) {
  const runner = fakeWorkflow({
    mode: "plan",
    path: "knowledge",
    "source-id": "src-1",
    "api-key": KEY,
    "api-url": "https://api.leafchat.app",
    comment: "true",
    "github-token": "ghs_token",
    "confirm-deleted-files": "true",
    wait: "true",
    ...options.inputs,
  });
  const api = fakeSyncApi({ sync: (options.sync ?? [syncResponse()]).map(ok) });
  const comments = fakePrComments(options.commentError ?? null);
  const planFiles: string[] = [];
  const io: ActionIo = {
    env: {
      GITHUB_ACTIONS: "true",
      GITHUB_EVENT_NAME: options.event,
      GITHUB_REPOSITORY: "acme/handbook",
      GITHUB_SERVER_URL: "https://github.com",
      GITHUB_RUN_ID: "42",
    },
    workspace: WORKSPACE,
    workflow: runner.workflow,
    eventPayload: options.payload,
    realpath: fakeRealpath({
      [WORKSPACE]: WORKSPACE,
      [`${WORKSPACE}/knowledge`]: `${WORKSPACE}/knowledge`,
    }),
    tree: () => fakeTree(options.tree ?? [MD]),
    api: () => api.api,
    git: fakeGitHistory(null).git,
    clock: fakeClock(Date.parse("2026-10-05T03:04:05Z")).clock,
    prComments: () => comments.client,
    writePlanFile: async (json) => {
      planFiles.push(json);
      return PLAN_FILE;
    },
  };
  return {
    run: () => runAction(io),
    runner,
    requests: () => api.syncRequests.length,
    comments: comments.upserts,
    planFile: () => JSON.parse(planFiles[0] ?? "null"),
  };
}

describe("GitHub Action", () => {
  test.each([
    {
      label: "PR のイベントの apply",
      event: "pull_request",
      payload: SAME_REPO_PR,
      mode: "apply",
      message: "pull request では反映（mode: apply）しません。",
    },
    {
      label: "pull_request_target",
      event: "pull_request_target",
      payload: FORK_PR,
      mode: "plan",
      message: "この Action は pull_request_target では動きません",
    },
  ])(
    "$label は失敗にし、leafchat の API を呼ばない",
    async ({ event, payload, mode, message }) => {
      const action = setup({ event, payload, inputs: { mode } });

      await action.run();

      expect({
        failures: action.runner.failures,
        requests: action.requests(),
      }).toEqual({
        failures: [expect.stringContaining(message)],
        requests: 0,
      });
    },
  );

  test.each([
    {
      label: "フォークの PR",
      payload: FORK_PR,
      inputs: { "api-key": KEY },
      comments: 0,
    },
    {
      label: "鍵の渡らない同じリポジトリの PR（Dependabot など）",
      payload: SAME_REPO_PR,
      inputs: { "api-key": "" },
      comments: 1,
    },
  ])(
    "$label の plan は、送る前の検査に落とし、理由を注意と要約に出して、成功で終わる",
    async ({ payload, inputs, comments }) => {
      const action = setup({ event: "pull_request", payload, inputs });

      await action.run();

      const fallback =
        "サーバーの計画を省きました（api-key がありません。フォークからの PR には GitHub が秘密を渡しません）。送る前の検査だけを行いました。";
      expect({
        failures: action.runner.failures,
        requests: action.requests(),
        annotations: action.runner.annotations,
        summaries: action.runner.summaries,
        comments: action.comments.length,
        outputs: action.runner.outputs,
      }).toEqual({
        failures: [],
        requests: 0,
        annotations: [
          { level: "notice", text: fallback, title: null, file: null },
        ],
        summaries: [expect.stringContaining(`\n\n${fallback}\n`)],
        comments,
        outputs: { "has-changes": "false", "plan-file": PLAN_FILE },
      });
    },
  );

  test("検査のエラーを、リポジトリのルートからのパスつきの注釈にし、失敗で終わる", async () => {
    const action = setup({
      event: "push",
      payload: { before: "0".repeat(40) },
      inputs: { mode: "check" },
      tree: [MD, { path: "渋谷店/メニュー/ランチ.pdf", content: "%PDF-1.7" }],
    });

    await action.run();

    expect({
      annotations: action.runner.annotations,
      failures: action.runner.failures,
      planFile: action.planFile(),
    }).toMatchObject({
      annotations: [
        {
          level: "error",
          text: "渋谷店/メニュー/ランチ.pdf：フォルダは 1 階層までです。「渋谷店」の直下へ移してください。",
          title: "leafchat の検査のエラー",
          file: "knowledge/渋谷店/メニュー/ランチ.pdf",
        },
      ],
      failures: [
        "送る前の検査でエラーが 1 件あります。注釈かジョブの要約を見て直してください。",
      ],
      planFile: { command: "check", plan: null, ok: false },
    });
  });

  test("同じリポジトリの PR の plan は、要約と PR の固定のコメントと出力（has-changes・plan-file）を書き、鍵を伏せる", async () => {
    const action = setup({
      event: "pull_request",
      payload: SAME_REPO_PR,
      sync: [CREATE_ONE],
    });

    await action.run();

    expect({
      failures: action.runner.failures,
      secrets: action.runner.secrets,
      summaries: action.runner.summaries,
      comments: action.comments,
      outputs: action.runner.outputs,
      planFile: action.planFile(),
    }).toMatchObject({
      failures: [],
      secrets: [KEY, "ghs_token"],
      summaries: [expect.stringContaining("| 作成 | 1 |")],
      comments: [
        {
          pr: 7,
          marker: "<!-- leafchat-cli:plan source=src-1 path=knowledge -->",
          body: expect.stringMatching(
            /^<!-- leafchat-cli:plan source=src-1 path=knowledge -->\n### leafchat の同期の計画（ソース src-1）\n\nフォルダ `knowledge`・2026-10-05 03:04 UTC・leafchat-cli /,
          ),
        },
      ],
      outputs: { "has-changes": "true", "plan-file": PLAN_FILE },
      planFile: {
        version: 1,
        command: "plan",
        source_id: "src-1",
        ok: true,
        summary: { create: 1 },
      },
    });
  });

  test("PR にコメントできなくても、注意を出して成功で終わる", async () => {
    const action = setup({
      event: "pull_request",
      payload: SAME_REPO_PR,
      commentError: new Error(
        "GitHub API が 403 を返しました（POST /repos/acme/handbook/issues/7/comments）",
      ),
    });

    await action.run();

    expect({
      failures: action.runner.failures,
      annotations: action.runner.annotations,
    }).toEqual({
      failures: [],
      annotations: [
        {
          level: "warning",
          text: "PR にコメントできませんでした（permissions に pull-requests: write が要ります）：GitHub API が 403 を返しました（POST /repos/acme/handbook/issues/7/comments）",
          title: null,
          file: null,
        },
      ],
    });
  });
});
