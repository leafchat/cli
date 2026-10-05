import { expect, test } from "vitest";
import { createGitHistory, type ExecFile } from "./git-history.ts";

const encoder = new TextEncoder();

/** 決まった標準出力を返す execFile。呼ばれた引数を calls に積む。output が Error なら投げる（git の失敗）。 */
function fakeExecFile(output: string | Error): {
  exec: ExecFile;
  calls: { file: string; args: readonly string[]; cwd: string }[];
} {
  const calls: { file: string; args: readonly string[]; cwd: string }[] = [];
  return {
    calls,
    exec: async (file, args, options) => {
      calls.push({ file, args: [...args], cwd: options.cwd });
      if (output instanceof Error) throw output;
      return encoder.encode(output);
    },
  };
}

test("D の行だけを、ルートからの相対パス（NFC）で返す", async () => {
  const fake = fakeExecFile(
    ["D", "共通/旧料金表.pdf", "M", "a.md", "D", "か\u3099.md", ""].join("\0"),
  );

  const deleted = await createGitHistory({ exec: fake.exec }).deletedSince({
    ref: "a1b2c3d",
    root: "/repo/knowledge",
  });

  expect({ deleted, calls: fake.calls }).toEqual({
    deleted: ["が.md", "共通/旧料金表.pdf"],
    calls: [
      {
        file: "git",
        args: [
          "diff",
          "--name-status",
          "-z",
          "--no-renames",
          "--relative",
          "a1b2c3d",
          "HEAD",
          "--",
          ".",
        ],
        cwd: "/repo/knowledge",
      },
    ],
  });
});

test.each(["-p", "--output=/tmp/x", "main..evil", "a b", ""])(
  "オプションに見える ref・範囲・空白・空の ref（「%s」）は受けない",
  async (ref) => {
    const fake = fakeExecFile("");

    const deleting = createGitHistory({ exec: fake.exec }).deletedSince({
      ref,
      root: "/repo/knowledge",
    });

    await expect(deleting).rejects.toThrow("使えません");
  },
);

test("全て 0 の ref（新しいブランチの before）は履歴が無いとして null を返し、git を呼ばない", async () => {
  const fake = fakeExecFile("");

  const deleted = await createGitHistory({ exec: fake.exec }).deletedSince({
    ref: "0".repeat(40),
    root: "/repo/knowledge",
  });

  expect({ deleted, calls: fake.calls }).toEqual({ deleted: null, calls: [] });
});

test("git が失敗したら（浅い clone で ref が無いなど）null を返す", async () => {
  const fake = fakeExecFile(new Error("fatal: bad revision 'a1b2c3d'"));

  const deleted = await createGitHistory({ exec: fake.exec }).deletedSince({
    ref: "a1b2c3d",
    root: "/repo/knowledge",
  });

  expect(deleted).toBeNull();
});
