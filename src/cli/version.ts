declare const __LEAFCHAT_CLI_VERSION__: string | undefined;

// Why typeof で見るか: esbuild の define が package.json の版に置き換える。ビルドせずに node で動かす（pnpm leafchat）ときは定義が無い。
export const CLI_VERSION =
  typeof __LEAFCHAT_CLI_VERSION__ === "string"
    ? __LEAFCHAT_CLI_VERSION__
    : "0.0.0-dev";
