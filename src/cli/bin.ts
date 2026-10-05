import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { styleText } from "node:util";
import { realClock } from "../infrastructure/clock.ts";
import { createFsTreeReader } from "../infrastructure/fs-tree.ts";
import {
  createGitHistory,
  realExecFile,
} from "../infrastructure/git-history.ts";
import { createLeafchatSyncApi } from "../infrastructure/leafchat-api.ts";
import { main } from "./main.ts";

// 組み立ての根。本物の入出力と具象を main に渡す（main.ts はテストからフェイクを受ける）。

process.exitCode = await main(process.argv.slice(2), {
  env: process.env,
  stdout: (text) => {
    process.stdout.write(text);
  },
  stderr: (text) => {
    process.stderr.write(text);
  },
  interactive: process.stdin.isTTY === true && process.stderr.isTTY === true,
  stderrIsTty: process.stderr.isTTY === true,
  ask: async (question) => {
    const prompt = createInterface({
      input: process.stdin,
      output: process.stderr,
    });
    try {
      return await prompt.question(question);
    } finally {
      prompt.close();
    }
  },
  // Why styleText の既定に任せるか: stdout が端末でないとき・NO_COLOR・FORCE_COLOR を Node が見て決める。
  paint: (style, text) => styleText(style, text),
  resolvePath: (dir) => resolve(dir),
  tree: (root) => createFsTreeReader({ root }),
  api: (params) =>
    createLeafchatSyncApi({
      ...params,
      fetch: globalThis.fetch,
      sleep: realClock.sleep,
    }),
  git: createGitHistory({ exec: realExecFile }),
  clock: realClock,
});
