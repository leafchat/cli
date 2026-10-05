import { describe, expect, test } from "vitest";
import { checkSyncPath, type SyncPathError } from "./sync-path.ts";

// leafchat のサーバーの external-id.test.ts・sync-path.test.ts と同じ値で、同じ境界を確かめる。

describe("同期のパスの規則", () => {
  test.each([
    {
      label: "1 階層のパス",
      path: "営業時間.md",
      parsed: {
        folderName: null,
        filename: "営業時間.md",
        mime: "text/markdown",
      },
    },
    {
      label: "2 階層のパス",
      path: "渋谷店/営業時間.md",
      parsed: {
        folderName: "渋谷店",
        filename: "営業時間.md",
        mime: "text/markdown",
      },
    },
    {
      label: "空白を含むファイル名",
      path: "料金表 2026.pdf",
      parsed: {
        folderName: null,
        filename: "料金表_2026.pdf",
        mime: "application/pdf",
      },
    },
  ])("$label は、フォルダ名・ファイル名・形式に分ける", ({ path, parsed }) => {
    const result = checkSyncPath(path);

    expect(result).toEqual({ ok: true, value: parsed });
  });

  test.each<{ label: string; path: string; error: SyncPathError }>([
    { label: "空", path: "", error: "empty" },
    { label: "孤立したサロゲート", path: "a\uD800b.md", error: "malformed" },
    {
      label:
        "UTF-8 でちょうど 512 バイト（バイトの規則は通り、拡張子で止まる）",
      path: `${"あ".repeat(170)}ab`,
      error: "extension",
    },
    {
      label: "UTF-8 で 513 バイト",
      path: `${"あ".repeat(170)}abc`,
      error: "too_long",
    },
    { label: "NFD の「が」", path: "か\u3099.md", error: "not_nfc" },
    { label: "NUL", path: "a\u0000b.md", error: "forbidden_char" },
    { label: "DEL", path: "a\u007Fb.md", error: "forbidden_char" },
    { label: "C1 の NEL", path: "a\u0085b.md", error: "forbidden_char" },
    { label: "U+202E（RLO）", path: "a\u202Eb.md", error: "forbidden_char" },
    { label: "U+2066（LRI）", path: "a\u2066b.md", error: "forbidden_char" },
    { label: "バックスラッシュ", path: "a\\b.md", error: "forbidden_char" },
    { label: "先頭の /", path: "/a.md", error: "empty_segment" },
    { label: "末尾の /", path: "a/", error: "empty_segment" },
    { label: "続けた //", path: "a//b.md", error: "empty_segment" },
    { label: "区切りの .", path: "./a.md", error: "dot_segment" },
    { label: "区切りの ..", path: "a/../b.md", error: "dot_segment" },
    { label: "区切りの前の空白", path: " a/b.md", error: "segment_whitespace" },
    {
      label: "区切りの後ろの空白",
      path: "a /b.md",
      error: "segment_whitespace",
    },
    { label: "3 階層", path: "渋谷店/2026/営業時間.md", error: "depth" },
    {
      label: "61 文字のフォルダ名",
      path: `${"店".repeat(61)}/a.md`,
      error: "folder_name",
    },
    {
      label: "対応しない拡張子（.xlsx）",
      path: "料金表.xlsx",
      error: "extension",
    },
    {
      label: "41 文字のファイル名",
      path: `${"あ".repeat(38)}.md`,
      error: "filename",
    },
  ])("$label のパスは $error", ({ path, error }) => {
    const result = checkSyncPath(path);

    expect(result).toEqual({ ok: false, error });
  });

  test.each([
    { label: "60 文字のフォルダ名", path: `${"店".repeat(60)}/a.md` },
    { label: "40 文字のファイル名", path: `${"あ".repeat(37)}.md` },
  ])("$label のパスは通る", ({ path }) => {
    const result = checkSyncPath(path);

    expect(result.ok).toBe(true);
  });
});
