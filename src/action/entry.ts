import { realpathSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { realClock } from "../infrastructure/clock.ts";
import { createFsTreeReader } from "../infrastructure/fs-tree.ts";
import {
  createGitHistory,
  realExecFile,
} from "../infrastructure/git-history.ts";
import { createPrCommentClient } from "../infrastructure/github-pr-comment.ts";
import { githubWorkflow } from "../infrastructure/github-workflow.ts";
import { createLeafchatSyncApi } from "../infrastructure/leafchat-api.ts";
import { runAction } from "./main.ts";

// Action の組み立ての根（dist/action.js の入口）。本物の入出力と具象を runAction に渡す。

const { env } = process;

async function readEventPayload(path: string | undefined): Promise<unknown> {
  if (path === undefined || path === "") return null;
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

try {
  await runAction({
    env,
    workspace: env.GITHUB_WORKSPACE ?? process.cwd(),
    workflow: githubWorkflow,
    eventPayload: await readEventPayload(env.GITHUB_EVENT_PATH),
    realpath: (path) => realpathSync(path),
    tree: (root) => createFsTreeReader({ root }),
    api: (params) =>
      createLeafchatSyncApi({
        ...params,
        fetch: globalThis.fetch,
        sleep: realClock.sleep,
      }),
    git: createGitHistory({ exec: realExecFile }),
    clock: realClock,
    prComments: (token) =>
      createPrCommentClient({
        token,
        apiUrl: env.GITHUB_API_URL ?? "https://api.github.com",
        graphqlUrl: env.GITHUB_GRAPHQL_URL ?? "https://api.github.com/graphql",
        repository: env.GITHUB_REPOSITORY ?? "",
        fetch: globalThis.fetch,
      }),
    // Why 毎回別のフォルダを作るか: 同じジョブで Action を 2 回（2 つのフォルダ・ソース）使っても、互いの計画を上書きしない。
    writePlanFile: async (json) => {
      const dir = await mkdtemp(join(env.RUNNER_TEMP ?? tmpdir(), "leafchat-"));
      const path = join(dir, "plan.json");
      await writeFile(path, json, { mode: 0o600 });
      return path;
    },
  });
} catch (error) {
  githubWorkflow.setFailed(
    error instanceof Error ? error.message : String(error),
  );
}
