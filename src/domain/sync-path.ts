import { type KnowledgeMime, mimeOfFilename } from "./formats.ts";
import {
  FILENAME_MAX_CHARS,
  FOLDER_NAME_MAX_CHARS,
  SYNC_PATH_MAX_BYTES,
} from "./limits.ts";
import { err, ok, type Result } from "./result.ts";
import { safeFilename } from "./safe-filename.ts";

// leafchat のサーバーの checkExternalId と parseSyncPath の写し。同じ順で同じ誤りを返す。

export type SyncPathError =
  | "empty"
  | "too_long"
  | "malformed"
  | "not_nfc"
  | "forbidden_char"
  | "empty_segment"
  | "dot_segment"
  | "segment_whitespace"
  | "depth"
  | "folder_name"
  | "extension"
  | "filename";

export type ParsedSyncPath = Readonly<{
  folderName: string | null;
  filename: string;
  mime: KnowledgeMime;
}>;

/*
  Why 双方向の制御文字を拒むか: 画面や PR のコメントで、ファイル名の見た目と中身を食い違わせられる（Trojan Source）。
  Why 正規表現でなく符号位置で比べるか: 制御文字の範囲を正規表現に書くと Biome の noControlCharactersInRegex に当たる。
*/
const isForbiddenCodePoint = (cp: number): boolean =>
  cp <= 0x1f ||
  (cp >= 0x7f && cp <= 0x9f) ||
  (cp >= 0x202a && cp <= 0x202e) ||
  (cp >= 0x2066 && cp <= 0x2069) ||
  cp === 0x5c;

const hasForbiddenChar = (path: string): boolean => {
  for (const ch of path) {
    const cp = ch.codePointAt(0);
    if (cp !== undefined && isForbiddenCodePoint(cp)) return true;
  }
  return false;
};

const encoder = new TextEncoder();

function checkCharacters(path: string): SyncPathError | null {
  if (path.length === 0) return "empty";
  if (!path.isWellFormed()) return "malformed";
  if (encoder.encode(path).byteLength > SYNC_PATH_MAX_BYTES) return "too_long";
  if (path.normalize("NFC") !== path) return "not_nfc";
  if (hasForbiddenChar(path)) return "forbidden_char";
  for (const segment of path.split("/")) {
    if (segment.length === 0) return "empty_segment";
    if (segment === "." || segment === "..") return "dot_segment";
    if (segment.trim() !== segment) return "segment_whitespace";
  }
  return null;
}

export function checkSyncPath(
  path: string,
): Result<ParsedSyncPath, SyncPathError> {
  const invalid = checkCharacters(path);
  if (invalid !== null) return err(invalid);
  const segments = path.split("/");
  // Why 3 階層から読み替えずに止めるか: leafchat のフォルダは 1 階層だけで、読み替えると置いた場所と画面の形がずれる。
  if (segments.length > 2) return err("depth");
  const folderName = segments.length === 2 ? (segments[0] ?? null) : null;
  if (folderName !== null && folderName.length > FOLDER_NAME_MAX_CHARS) {
    return err("folder_name");
  }
  const basename = segments.at(-1) ?? "";
  const mime = mimeOfFilename(basename);
  if (mime === null) return err("extension");
  const filename = safeFilename(basename);
  if (filename.length > FILENAME_MAX_CHARS) return err("filename");
  return ok({ folderName, filename, mime });
}
