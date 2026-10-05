import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, onTestFinished, test } from "vitest";
import { createFsTreeReader } from "./fs-tree.ts";

const encoder = new TextEncoder();

/** OS の一時ディレクトリに、files（相対パス → 中身）を書いたフォルダを作る。テストの後に消す。 */
async function tempTree(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "leafchat-cli-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

test("ドットで始まる名前と Office の一時ファイルを返さず、シンボリックリンクをたどらず、NFD の名前を NFC の相対パスで返す", async () => {
  const root = await tempTree({
    "a.md": "abc",
    "店/b.pdf": "%PDF-1.7",
    "か\u3099.md": "# が",
    ".hidden.md": "隠す",
    ".git/config": "[core]",
    "~$報告書.docx": "一時",
    "Thumbs.db": "x",
    "desktop.ini": "x",
  });
  await symlink(join(root, "a.md"), join(root, "link.md"));

  const listing = await createFsTreeReader({ root }).list();

  expect(listing).toEqual({
    entries: [
      {
        path: "a.md",
        originalPath: "a.md",
        size: 3,
        kind: "file",
        head: encoder.encode("abc"),
      },
      {
        path: "link.md",
        originalPath: "link.md",
        size: 0,
        kind: "symlink",
        head: new Uint8Array(),
      },
      {
        path: "が.md",
        originalPath: "か\u3099.md",
        size: 5,
        kind: "file",
        head: encoder.encode("# が"),
      },
      {
        path: "店/b.pdf",
        originalPath: "店/b.pdf",
        size: 8,
        kind: "file",
        head: encoder.encode("%PDF-1.7"),
      },
    ],
    truncated: false,
  });
});

test("ファイルの中身の SHA-256 を 16 進の小文字で返す", async () => {
  const root = await tempTree({ "a.md": "abc" });

  const sha = await createFsTreeReader({ root }).sha256("a.md");

  expect(sha).toBe(
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});
