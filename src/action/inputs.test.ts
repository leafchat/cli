import { describe, expect, test } from "vitest";
import { fakeRealpath } from "../test/fakes.ts";
import { expectErr, expectOk } from "../test/result.ts";
import { readInputs } from "./inputs.ts";

const WORKSPACE = "/home/runner/work/repo/repo";

/** ワークスペースの中の link は、ランナーの別の場所を指す。 */
const realpath = fakeRealpath({
  [WORKSPACE]: WORKSPACE,
  [`${WORKSPACE}/knowledge`]: `${WORKSPACE}/knowledge`,
  [`${WORKSPACE}/link`]: "/home/runner/.ssh",
  "/home/runner/work/repo/outside": "/home/runner/work/repo/outside",
  "/home/runner/work/repo/repo-secrets": "/home/runner/work/repo/repo-secrets",
});

/** 既定は「path だけを渡し、ほかは action.yml の既定値」。 */
const read = (inputs: Readonly<Record<string, string>> = {}) =>
  readInputs({
    getInput: (name) =>
      ({
        mode: "plan",
        path: "knowledge",
        "source-id": "",
        "api-key": "",
        "api-url": "https://api.leafchat.app",
        comment: "true",
        "github-token": "ghs_token",
        "confirm-deletes": "",
        "confirm-deleted-files": "true",
        wait: "true",
        ...inputs,
      })[name] ?? "",
    workspace: WORKSPACE,
    realpath,
  });

describe("Action の入力", () => {
  test("既定の入力では、plan・コメントあり・git の履歴で削除を確かめる・取り込みを待つ、になる", () => {
    const result = read();

    expect(expectOk(result)).toEqual({
      mode: "plan",
      path: `${WORKSPACE}/knowledge`,
      displayPath: "knowledge",
      sourceId: null,
      apiKey: null,
      apiUrl: "https://api.leafchat.app",
      comment: true,
      githubToken: "ghs_token",
      confirmDeletes: [],
      confirmDeletedFiles: true,
      wait: true,
    });
  });

  test.each([
    { input: "mode", value: "sync" },
    { input: "comment", value: "yes" },
    { input: "confirm-deleted-files", value: "1" },
    { input: "wait", value: "no" },
  ])(
    "$input に「$value」を渡すと、入力の名前つきの誤りにする",
    ({ input, value }) => {
      const result = read({ [input]: value });

      expect(expectErr(result)).toMatchObject({ input });
    },
  );

  test.each([
    { label: "../ でワークスペースの外", path: "../outside" },
    {
      label: "名前がワークスペースで始まる隣のフォルダ",
      path: "../repo-secrets",
    },
    { label: "実体がワークスペースの外にあるリンク", path: "link" },
    { label: "無いフォルダ", path: "missing" },
  ])("path が$labelなら誤りにする", ({ path }) => {
    const result = read({ path });

    expect(expectErr(result)).toMatchObject({ input: "path" });
  });

  test("confirm-deletes は行で分け、前後の空白と空行を捨て、NFC にそろえる", () => {
    const result = read({
      "confirm-deletes": `  共通/旧料金表.pdf  \n\n${"\u30AB\u3099"}.md\r\n`,
    });

    expect(expectOk(result).confirmDeletes).toEqual([
      "共通/旧料金表.pdf",
      "\u30AC.md",
    ]);
  });
});
