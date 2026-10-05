import { describe, expect, test } from "vitest";
import { hashedEntry } from "../test/mother.ts";
import { buildFiles, readText } from "./manifest.ts";

const PDF_SHA = "2".repeat(64);

describe("送る一式", () => {
  test("テキストは本文つき・PDF は参照になり、パスの昇順に並ぶ", () => {
    const result = buildFiles([
      hashedEntry({
        path: "共通/料金表.pdf",
        size: 2048,
        mime: "application/pdf",
        sha256: PDF_SHA,
        text: null,
      }),
      hashedEntry({ path: "よくある質問.md", text: "# よくある質問\n" }),
    ]);

    expect(result).toEqual({
      files: [
        {
          path: "よくある質問.md",
          content: "# よくある質問\n",
          content_type: "text/markdown",
        },
        {
          path: "共通/料金表.pdf",
          sha256: PDF_SHA,
          size: 2048,
          content_type: "application/pdf",
        },
      ],
      inlineSkipped: [],
    });
  });

  test("本文の合計が予算（JSON で 7 MiB）ちょうどまでは本文つき、超えた分のテキストは参照になり、省いた一覧に入る", () => {
    const result = buildFiles([
      hashedEntry({ path: "a.md", text: "a".repeat(4_000_000) }),
      hashedEntry({ path: "b.md", text: "b".repeat(3_340_028) }),
      hashedEntry({ path: "c.md", size: 1, sha256: PDF_SHA, text: "c" }),
    ]);

    expect({
      kinds: result.files.map((file) => [file.path, "content" in file]),
      inlineSkipped: result.inlineSkipped,
    }).toEqual({
      kinds: [
        ["a.md", true],
        ["b.md", true],
        ["c.md", false],
      ],
      inlineSkipped: ["c.md"],
    });
  });

  test("JSON にしたときにエスケープで増える分も、予算に数える", () => {
    const result = buildFiles([
      hashedEntry({ path: "a.md", text: "\n".repeat(3_670_015) }),
      hashedEntry({ path: "b.md", text: "b" }),
    ]);

    expect(result.inlineSkipped).toEqual(["b.md"]);
  });
});

const BOM = String.fromCharCode(0xfeff);

test.each([
  {
    label: "BOM つきの UTF-8 は、BOM を落とさずに読む",
    bytes: new Uint8Array([0xef, 0xbb, 0xbf, 0x23]),
    text: `${BOM}#`,
  },
  {
    label: "UTF-8 として不正なバイトは、置き換えずに null",
    bytes: new Uint8Array([0x23, 0xff]),
    text: null,
  },
])("テキストの本文の読み方（$label）", ({ bytes, text }) => {
  const result = readText(bytes);

  expect(result).toBe(text);
});
