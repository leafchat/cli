// Git LFS のポインタファイルの書式（https://github.com/git-lfs/git-lfs/blob/main/docs/spec.md）。1024 バイトより大きいものはポインタではない。
const POINTER_PREFIX = new TextEncoder().encode(
  "version https://git-lfs.github.com/spec/v1\n",
);
const POINTER_MAX_BYTES = 1024;

export function isLfsPointer(head: Uint8Array, size: number): boolean {
  if (size > POINTER_MAX_BYTES || head.byteLength < POINTER_PREFIX.byteLength) {
    return false;
  }
  return POINTER_PREFIX.every((byte, index) => head[index] === byte);
}
