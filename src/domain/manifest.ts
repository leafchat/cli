import { isTextMime } from "./formats.ts";
import { INLINE_BUDGET_BYTES } from "./limits.ts";
import type { CheckedEntry } from "./local-check.ts";
import { ascending } from "./order.ts";
import type { SyncFile } from "./sync-contract.ts";

/**
 * text は md・txt・json を `new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })` で読んだもの（読めなければ null）。
 * Why fatal と ignoreBOM か: 既定の TextDecoder は BOM を落とし、不正なバイトを置き換える。
 * サーバーは受け取った文字列を UTF-8 に戻してハッシュを取るので、落としたり置き換えたりすると、同じファイルを参照で送ったとき（生のバイト列のハッシュ）と値が変わり、偽の更新や名前の変更の見落としが起きる。
 */
export type HashedEntry = CheckedEntry &
  Readonly<{ sha256: string; text: string | null }>;

const encoder = new TextEncoder();
const strictDecoder = new TextDecoder("utf-8", {
  fatal: true,
  ignoreBOM: true,
});

/** md・txt・json の本文。UTF-8 として読めなければ null（HashedEntry の Why を参照）。 */
export function readText(bytes: Uint8Array): string | null {
  try {
    return strictDecoder.decode(bytes);
  } catch {
    return null;
  }
}

/*
  Why テキストを本文ごと送るか: サーバーがパートの数とチャンク境界を確かめられる（参照の項目は中身を受け取る前に計画する）。
  Why 予算を超えたテキストを参照に回すか: 一式の本文は 8 MiB まで。止めずに送れる形にし、検査を省いたことは表示で知らせる。
  先に（パスの昇順で）入ったものから本文つきにする。
*/
export function buildFiles(entries: readonly HashedEntry[]): {
  files: SyncFile[];
  inlineSkipped: string[];
} {
  const files: SyncFile[] = [];
  const inlineSkipped: string[] = [];
  let budget = INLINE_BUDGET_BYTES;
  for (const entry of entries.toSorted((a, b) => ascending(a.path, b.path))) {
    const ref: SyncFile = {
      path: entry.path,
      sha256: entry.sha256,
      size: entry.size,
      content_type: entry.mime,
    };
    if (!isTextMime(entry.mime) || entry.text === null) {
      files.push(ref);
      continue;
    }
    const jsonBytes = encoder.encode(JSON.stringify(entry.text)).byteLength;
    if (jsonBytes > budget) {
      files.push(ref);
      inlineSkipped.push(entry.path);
      continue;
    }
    budget -= jsonBytes;
    files.push({
      path: entry.path,
      content: entry.text,
      content_type: entry.mime,
    });
  }
  return { files, inlineSkipped };
}
