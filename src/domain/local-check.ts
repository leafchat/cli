import { type KnowledgeMime, maxBytesOf } from "./formats.ts";
import { isLfsPointer } from "./lfs-pointer.ts";
import { SYNC_MAX_FILES } from "./limits.ts";
import { ascending } from "./order.ts";
import { checkSyncPath } from "./sync-path.ts";

export type LocalEntry = Readonly<{
  /** ルートからの相対パス（`/` 区切り・NFC にそろえた後）。 */
  path: string;
  /** ファイルシステムの元の名前（NFD のまま等）。読むときと表示に使う。 */
  originalPath: string;
  size: number;
  /** directory は、深すぎて中を読まなかったフォルダ。 */
  kind: "file" | "symlink" | "directory";
  /** 先頭 1024 バイト（Git LFS のポインタの判定用）。 */
  head: Uint8Array;
}>;

export type CheckedEntry = LocalEntry & Readonly<{ mime: KnowledgeMime }>;

const FINDING_CODES = [
  "symlink",
  "path_depth",
  "path_invalid",
  "folder_name",
  "filename",
  "unsupported_format",
  "empty_file",
  "too_large",
  "lfs_pointer",
  "not_utf8",
  "duplicate",
  "too_many_files",
] as const;

type FindingCode = (typeof FINDING_CODES)[number];

export type Finding = Readonly<{
  code: FindingCode;
  severity: "error" | "warning";
  path: string | null;
  /** 文に入れる値（フォルダ名・理由・上限など）。 */
  detail: string | null;
}>;

const error = (
  code: FindingCode,
  path: string | null,
  detail: string | null = null,
): Finding => ({ code, severity: "error", path, detail });

const topFolderOf = (path: string) => path.split("/")[0] ?? path;

const extensionOf = (path: string) => {
  const name = path.split("/").at(-1) ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : null;
};

function checkEntry(
  entry: LocalEntry,
): { file: CheckedEntry; key: string } | Finding {
  const { path } = entry;
  if (entry.kind === "symlink") return error("symlink", path);
  if (entry.kind === "directory") {
    return error("path_depth", path, topFolderOf(path));
  }
  const parsed = checkSyncPath(path);
  if (!parsed.ok) {
    switch (parsed.error) {
      case "depth":
        return error("path_depth", path, topFolderOf(path));
      case "folder_name":
        return error("folder_name", path, topFolderOf(path));
      case "filename":
        return error("filename", path, path.split("/").at(-1) ?? path);
      // Why 止めずに外すか: 対応しない形式（画像・表計算など）を同じフォルダに置く運用を妨げない。
      case "extension":
        return {
          code: "unsupported_format",
          severity: "warning",
          path,
          detail: extensionOf(path),
        };
      default:
        return error("path_invalid", path, parsed.error);
    }
  }
  const { folderName, filename, mime } = parsed.value;
  if (entry.size === 0) return error("empty_file", path);
  if (isLfsPointer(entry.head, entry.size)) return error("lfs_pointer", path);
  const limit = maxBytesOf(mime);
  if (entry.size > limit) return error("too_large", path, String(limit));
  return {
    file: { ...entry, mime },
    key: folderName === null ? filename : `${folderName}/${filename}`,
  };
}

/** 検査の結果の並び（パスの昇順 → コードの順。パスの無いものは後ろ）。 */
export const compareFindings = (a: Finding, b: Finding): number => {
  if (a.path !== b.path) {
    if (a.path === null) return 1;
    if (b.path === null) return -1;
    return ascending(a.path, b.path);
  }
  return FINDING_CODES.indexOf(a.code) - FINDING_CODES.indexOf(b.code);
};

/**
 * 送る前の検査。返す files はエラーの無い送る対象（対応しない形式は外す）。
 * Why leafchat のファイル名で重なりを見るか: 空白などの置き換えの後で同じフォルダに同じ名前が 2 つあると、サーバーが一式を拒む。
 */
export function checkLocalEntries(
  entries: readonly LocalEntry[],
  scan: Readonly<{ truncated: boolean }> = { truncated: false },
): { files: CheckedEntry[]; findings: Finding[] } {
  const findings: Finding[] = [];
  const byKey = new Map<string, CheckedEntry[]>();
  for (const entry of entries) {
    const checked = checkEntry(entry);
    if ("code" in checked) {
      findings.push(checked);
      continue;
    }
    byKey.set(checked.key, [...(byKey.get(checked.key) ?? []), checked.file]);
  }
  const files: CheckedEntry[] = [];
  for (const [key, group] of byKey) {
    if (group.length === 1) {
      files.push(...group);
      continue;
    }
    findings.push(...group.map((file) => error("duplicate", file.path, key)));
  }
  if (scan.truncated) {
    findings.push(error("too_many_files", null));
  } else if (files.length > SYNC_MAX_FILES) {
    findings.push(error("too_many_files", null, String(files.length)));
  }
  return {
    files: files.toSorted((a, b) => ascending(a.path, b.path)),
    findings: findings.toSorted(compareFindings),
  };
}
