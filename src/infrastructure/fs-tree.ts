import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, open, opendir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { RICH_MAX_BYTES } from "../domain/limits.ts";
import type { LocalEntry } from "../domain/local-check.ts";
import { ascending } from "../domain/order.ts";

type TreeListing = Readonly<{
  entries: readonly LocalEntry[];
  /** 項目が多すぎて、走査を途中で打ち切ったか。 */
  truncated: boolean;
}>;

export type TreeReader = {
  /** ルートの下を走査する。シンボリックリンクはたどらず kind: "symlink" で返す。無視する名前は返さない。 */
  list(): Promise<TreeListing>;
  /** ファイルの中身の SHA-256（ストリームで読む）。パスはファイルシステムの元の名前（originalPath）。 */
  sha256(originalPath: string): Promise<string>;
  /** 中身（アップロードと本文つきのテキスト）。パスはファイルシステムの元の名前（originalPath）。 */
  read(originalPath: string): Promise<Uint8Array>;
};

// Why ドットで始まる名前を無視するか: .git・.github・.env・.DS_Store を送らない。~$ は Office が開いている間の一時ファイル。
const IGNORED_NAMES: ReadonlySet<string> = new Set([
  "Thumbs.db",
  "desktop.ini",
]);
const isIgnored = (name: string) =>
  name.startsWith(".") || name.startsWith("~$") || IGNORED_NAMES.has(name);

// Why 深さと数を区切るか: 誤って巨大なツリー（node_modules など）を指しても止まらずに終わらせる。どちらも検査の誤りとして知らせる。
const MAX_DEPTH = 8;
const MAX_ITEMS = 20_000;
const HEAD_BYTES = 1024;
const EMPTY = new Uint8Array();

async function readHead(path: string, size: number): Promise<Uint8Array> {
  const length = Math.min(size, HEAD_BYTES);
  if (length === 0) return EMPTY;
  const handle = await open(path, "r");
  try {
    const buffer = new Uint8Array(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

export function createFsTreeReader(params: { root: string }): TreeReader {
  const { root } = params;

  // Why 読む直前に lstat するか: 走査の後にシンボリックリンクへ差し替えられても、ルートの外のファイルを送らない。大きさも見てから読む。
  async function regularFile(originalPath: string): Promise<string> {
    const path = join(root, originalPath);
    const info = await lstat(path);
    if (!info.isFile() || info.size > RICH_MAX_BYTES) {
      throw new Error(
        `${originalPath} を読めません（普通のファイルでないか、大きすぎます）。`,
      );
    }
    return path;
  }

  return {
    async list() {
      const info = await stat(root).catch(() => null);
      if (!info?.isDirectory()) {
        throw new Error(
          `${root} はフォルダではありません。同期するフォルダを指定してください。`,
        );
      }
      const entries: LocalEntry[] = [];
      let visited = 0;
      let truncated = false;

      async function walk(dir: string, depth: number): Promise<void> {
        for await (const dirent of await opendir(dir)) {
          if (isIgnored(dirent.name)) continue;
          visited += 1;
          if (visited > MAX_ITEMS) {
            truncated = true;
            return;
          }
          const absolute = join(dir, dirent.name);
          const originalPath = relative(root, absolute).split(sep).join("/");
          const base = { path: originalPath.normalize("NFC"), originalPath };
          if (dirent.isSymbolicLink()) {
            entries.push({ ...base, size: 0, kind: "symlink", head: EMPTY });
          } else if (dirent.isDirectory()) {
            if (depth >= MAX_DEPTH) {
              entries.push({
                ...base,
                size: 0,
                kind: "directory",
                head: EMPTY,
              });
              continue;
            }
            await walk(absolute, depth + 1);
            if (truncated) return;
          } else if (dirent.isFile()) {
            const { size } = await lstat(absolute);
            entries.push({
              ...base,
              size,
              kind: "file",
              head: await readHead(absolute, size),
            });
          }
        }
      }

      await walk(root, 1);
      return {
        entries: entries.toSorted((a, b) => ascending(a.path, b.path)),
        truncated,
      };
    },

    async sha256(originalPath) {
      const hash = createHash("sha256");
      await pipeline(createReadStream(await regularFile(originalPath)), hash);
      return hash.digest("hex");
    },

    async read(originalPath) {
      return new Uint8Array(await readFile(await regularFile(originalPath)));
    },
  };
}
