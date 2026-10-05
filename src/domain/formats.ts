import { RICH_MAX_BYTES, TEXT_MAX_BYTES } from "./limits.ts";

// leafchat のサーバーの knowledge-format.ts の 7 形式の写し。

export type TextMime = "text/plain" | "text/markdown" | "application/json";

export type KnowledgeMime =
  | TextMime
  | "text/html"
  | "text/csv"
  | "application/pdf"
  | "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const FORMATS: readonly Readonly<{
  mime: KnowledgeMime;
  ext: readonly string[];
}>[] = [
  { mime: "text/plain", ext: ["txt", "text", "log"] },
  { mime: "text/markdown", ext: ["md", "markdown"] },
  { mime: "application/json", ext: ["json"] },
  { mime: "text/html", ext: ["html", "htm"] },
  { mime: "text/csv", ext: ["csv"] },
  { mime: "application/pdf", ext: ["pdf"] },
  {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ext: ["docx"],
  },
];

const extensionOf = (filename: string) => {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : "";
};

export function mimeOfFilename(filename: string): KnowledgeMime | null {
  const ext = extensionOf(filename);
  return FORMATS.find((format) => format.ext.includes(ext))?.mime ?? null;
}

export const isTextMime = (mime: KnowledgeMime): mime is TextMime =>
  mime === "text/plain" ||
  mime === "text/markdown" ||
  mime === "application/json";

// Why テキストを絞るか: サーバーはテキストの本文をそのまま索引し、原本の数倍のメモリを使う（knowledge-format.ts）。
export const maxBytesOf = (mime: KnowledgeMime): number =>
  isTextMime(mime) ? TEXT_MAX_BYTES : RICH_MAX_BYTES;
