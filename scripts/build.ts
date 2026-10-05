import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "esbuild";

// lib/leafchat.js（npm に載せる CLI）と dist/action.js（GitHub Action。コミットする）を作る。
// Why 束ねるか: 実行時の依存を持たない。利用者の npx は依存を入れず、install scripts も走らない。Action はタグの中身をそのまま動かす。

const root = fileURLToPath(new URL("..", import.meta.url));
const pkg: unknown = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const version =
  typeof pkg === "object" &&
  pkg !== null &&
  "version" in pkg &&
  typeof pkg.version === "string"
    ? pkg.version
    : null;
if (version === null) throw new Error("package.json に version がありません。");

/*
  Why 束ねた包みの LICENSE を写すか: commander・zod・@actions/core などはソースにライセンスの注記を持たず、legalComments では表記が出ない。
  MIT は写しにも著作権とライセンスの表示を求めるので、束ねた包みの LICENSE を THIRD_PARTY_LICENSES.txt に並べる。
*/
async function thirdPartyLicenses(
  inputs: readonly string[],
  outfile: string,
): Promise<string> {
  const packageDirs = new Set(
    inputs.flatMap((input) => {
      const match = /^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(input);
      return match?.[1] === undefined ? [] : [join(root, match[1])];
    }),
  );
  const sections: string[] = [];
  for (const dir of [...packageDirs].toSorted()) {
    const manifest: unknown = JSON.parse(
      await readFile(join(dir, "package.json"), "utf8"),
    );
    const name =
      typeof manifest === "object" && manifest !== null && "name" in manifest
        ? String(manifest.name)
        : dirname(dir);
    const licenseFile = (await readdir(dir)).find((file) =>
      /^licen[cs]e/i.test(file),
    );
    if (licenseFile === undefined) {
      throw new Error(
        `${name} に LICENSE がありません。ライセンスを確かめてください。`,
      );
    }
    sections.push(
      `${name}\n\n${(await readFile(join(dir, licenseFile), "utf8")).trim()}\n`,
    );
  }
  return `${outfile} に束ねた包みのライセンス\n\n${sections.join("\n----------------------------------------\n\n")}`;
}

/*
  Why @actions/http-client を副作用なしとみなすか: @actions/core は OIDC のトークン（getIDToken）のためだけに http-client を読み、http-client は読み込んだだけで tunnel と undici を動かす。
  使わない getIDToken のために 1 MB を束ねず、ESM で動かない tunnel の require("net") も入れない。使う関数が増えれば、esbuild は副作用なしでも束ねる。
*/
const unusedHttpClient: Plugin = {
  name: "actions-http-client-without-side-effects",
  setup(builder) {
    builder.onResolve(
      { filter: /^@actions\/http-client(?:\/|$)/ },
      async (args) => {
        if (args.pluginData === "resolved") return undefined;
        const resolved = await builder.resolve(args.path, {
          kind: args.kind,
          importer: args.importer,
          resolveDir: args.resolveDir,
          pluginData: "resolved",
        });
        return {
          path: resolved.path,
          namespace: resolved.namespace,
          external: resolved.external,
          errors: resolved.errors,
          sideEffects: false,
        };
      },
    );
  },
};

async function bundle(params: {
  entry: string;
  outdir: string;
  outfile: string;
  target: string;
  banner?: string;
  plugins?: Plugin[];
}): Promise<void> {
  await rm(join(root, params.outdir), { recursive: true, force: true });
  const outfile = `${params.outdir}/${params.outfile}`;
  const result = await build({
    absWorkingDir: root,
    metafile: true,
    entryPoints: [params.entry],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: params.target,
    ...(params.banner === undefined ? {} : { banner: { js: params.banner } }),
    plugins: params.plugins ?? [],
    define: { __LEAFCHAT_CLI_VERSION__: JSON.stringify(version) },
    // Why linked か: 束ねた包みの中のライセンスの注記を <outfile>.LEGAL.txt に出す（注記を持つ包みがあるときだけ出る）。
    legalComments: "linked",
    sourcemap: false,
    // Why minify しないか: 公開物を人が読んで確かめられるようにする。
    minify: false,
    logLevel: "info",
  });
  // Why 出力に入ったものだけを数えるか: metafile.inputs は木の揺さぶりで落とした包み（http-client など）も含む。
  const bundled = Object.entries(
    result.metafile.outputs[outfile]?.inputs ?? {},
  ).flatMap(([input, { bytesInOutput }]) => (bytesInOutput > 0 ? [input] : []));
  await writeFile(
    join(root, params.outdir, "THIRD_PARTY_LICENSES.txt"),
    await thirdPartyLicenses(bundled, outfile),
  );
}

await bundle({
  entry: "src/cli/bin.ts",
  outdir: "lib",
  outfile: "leafchat.js",
  target: "node22.12",
  banner: "#!/usr/bin/env node",
});
// Why node24 か: action.yml の runs.using と同じ。Actions のランナーは Node 24 で動かす。
await bundle({
  entry: "src/action/entry.ts",
  outdir: "dist",
  outfile: "action.js",
  target: "node24",
  plugins: [unusedHttpClient],
});
