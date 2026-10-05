import { expect, test } from "vitest";
import { isLfsPointer } from "./lfs-pointer.ts";

const POINTER = new TextEncoder().encode(
  "version https://git-lfs.github.com/spec/v1\noid sha256:4d7a214614ab2935c943f9e0ff69d22eadbb8f32b1258daaa5e2ca24d17e2393\nsize 12345\n",
);

test.each([
  {
    label: "ポインタファイルの先頭で 1024 バイト以下",
    head: POINTER,
    size: 132,
    expected: true,
  },
  { label: "ちょうど 1024 バイト", head: POINTER, size: 1024, expected: true },
  {
    label: "同じ先頭でも 1025 バイト",
    head: POINTER,
    size: 1025,
    expected: false,
  },
  {
    label: "別の先頭",
    head: new TextEncoder().encode(
      "# version https://git-lfs.github.com/spec/v1\n",
    ),
    size: 46,
    expected: false,
  },
  {
    label: "先頭より短い",
    head: POINTER.slice(0, 10),
    size: 10,
    expected: false,
  },
])("Git LFS のポインタファイルの判定（$label）", ({ head, size, expected }) => {
  const result = isLfsPointer(head, size);

  expect(result).toBe(expected);
});
