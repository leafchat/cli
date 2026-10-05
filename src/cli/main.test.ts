import { describe, expect, test } from "vitest";
import { ok } from "../domain/result.ts";
import type { SyncResponse } from "../domain/sync-contract.ts";
import {
  fakeClock,
  fakeGitHistory,
  fakeSyncApi,
  fakeTree,
} from "../test/fakes.ts";
import { syncPlan, syncResponse } from "../test/mother.ts";
import { type CliIo, main } from "./main.ts";

const KEY = `lck_${"A".repeat(43)}`;

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

/** 既定は「鍵とソースの ID あり・端末でない・Markdown 1 件のフォルダ・サーバーは何も変えない計画を返す」。 */
function setup(
  options: {
    env?: Record<string, string | undefined>;
    sync?: readonly SyncResponse[];
  } = {},
) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const api = fakeSyncApi({ sync: (options.sync ?? [syncResponse()]).map(ok) });
  const io: CliIo = {
    env: {
      LEAFCHAT_API_KEY: KEY,
      LEAFCHAT_SOURCE_ID: "src-1",
      ...options.env,
    },
    stdout: (text) => stdout.push(text),
    stderr: (text) => stderr.push(text),
    interactive: false,
    stderrIsTty: false,
    ask: async () => "n",
    paint: (_style, text) => text,
    resolvePath: (dir) => dir,
    tree: () =>
      fakeTree([{ path: "共通/営業時間.md", content: "# 営業時間\n" }]),
    api: () => api.api,
    git: fakeGitHistory(null).git,
    clock: fakeClock().clock,
  };
  return {
    run: (argv: string[]) => main(argv, io),
    stdout: () => stdout.join(""),
    stderr: () => stderr.join(""),
    requests: () => api.syncRequests.length,
  };
}

describe("コマンド", () => {
  test.each([
    ["sync", "plan", "./kb"],
    ["sync", "apply", "./kb", "--yes"],
  ])(
    "LEAFCHAT_API_KEY が無ければ、終了コード 1 と案内の文を出す（%s %s）",
    async (...argv) => {
      const cli = setup({ env: { LEAFCHAT_API_KEY: undefined } });

      const code = await cli.run(argv);

      expect({ code, stderr: cli.stderr() }).toEqual({
        code: 1,
        stderr: expect.stringContaining(
          "環境変数 LEAFCHAT_API_KEY に API キーを入れてください",
        ),
      });
    },
  );

  test.each([
    { label: "変更があれば 2", sync: [CREATE_ONE], code: 2 },
    { label: "変更が無ければ 0", sync: [syncResponse()], code: 0 },
  ])("plan --detailed-exitcode は、$label", async ({ sync, code }) => {
    const cli = setup({ sync });

    const result = await cli.run([
      "sync",
      "plan",
      "./kb",
      "--detailed-exitcode",
    ]);

    expect(result).toBe(code);
  });

  test("--json のとき stdout は JSON 1 つだけで、version: 1 を持つ", async () => {
    const cli = setup({ sync: [CREATE_ONE] });

    await cli.run(["sync", "plan", "./kb", "--json"]);

    const lines = cli.stdout().trimEnd().split("\n");
    expect({
      lines: lines.length,
      json: JSON.parse(lines[0] ?? "null"),
    }).toMatchObject({
      lines: 1,
      json: {
        version: 1,
        command: "plan",
        source_id: "src-1",
        ok: true,
        summary: { create: 1 },
      },
    });
  });

  test("端末でなく --yes も無い apply は、API を呼ばずに終了コード 1 にする", async () => {
    const cli = setup({ sync: [CREATE_ONE] });

    const code = await cli.run(["sync", "apply", "./kb"]);

    expect({ code, stderr: cli.stderr(), requests: cli.requests() }).toEqual({
      code: 1,
      stderr: expect.stringContaining("--yes を付けてください"),
      requests: 0,
    });
  });
});
