/** @type {import('dependency-cruiser').IConfiguration} */

const PACKAGES = [
  "core",
  "npm",
  "npm-dev",
  "npm-optional",
  "npm-peer",
  "npm-no-pkg",
  "npm-unknown",
];

module.exports = {
  extends: "dependency-cruiser/configs/recommended-strict",
  forbidden: [
    {
      name: "domain-no-outer-layer",
      comment:
        "domain/ は純粋な規則だけ。domain/ の外を読まない（テストの資材の src/test は、テストだけが読める。no-test-code-in-production が見る）。",
      severity: "error",
      from: { path: "^src/domain/" },
      to: { path: "^src/", pathNot: "^src/(domain|test)/" },
    },
    {
      name: "domain-no-io-or-packages",
      comment: "domain/ は Node の組み込みも npm の包みも読まない。",
      severity: "error",
      from: { path: "^src/domain/", pathNot: "\\.test\\.ts$" },
      to: { dependencyTypes: PACKAGES },
    },
    {
      name: "use-cases-no-impl",
      comment:
        "use-cases/ は infrastructure/ の型だけを読む（具象は cli/ が注入する）。",
      severity: "error",
      from: { path: "^src/use-cases/" },
      to: {
        path: "^src/infrastructure/",
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "use-cases-no-io",
      comment:
        "use-cases/ は Node の組み込みも npm の包みも読まない（入出力はポート経由）。",
      severity: "error",
      from: { path: "^src/use-cases/", pathNot: "\\.test\\.ts$" },
      to: { dependencyTypes: PACKAGES },
    },
    {
      name: "infrastructure-no-upper-layer",
      comment: "infrastructure/ は use-cases/ と cli/・action/ を読まない。",
      severity: "error",
      from: { path: "^src/infrastructure/" },
      to: { path: "^src/(use-cases|cli|action)/" },
    },
    {
      name: "entry-is-root",
      comment: "cli/・action/ は組み立ての根。ほかの層から読まない。",
      severity: "error",
      from: { path: "^src/(domain|use-cases|infrastructure|test)/" },
      to: { path: "^src/(cli|action)/" },
    },
    {
      name: "action-reads-only-cli-texts",
      comment:
        "action/ が読む cli/ は文言（messages.ts）と版（version.ts）だけ。CLI の解析（commander）を Action に束ねない。",
      severity: "error",
      from: { path: "^src/action/" },
      to: { path: "^src/cli/", pathNot: "^src/cli/(messages|version)\\.ts$" },
    },
    {
      name: "no-test-code-in-production",
      comment:
        "本番のコードはテストとテストの資材・vitest・fast-check を読まない。",
      severity: "error",
      from: { path: "^(src|scripts)/", pathNot: "(\\.test\\.ts$|^src/test/)" },
      // Why 名前で見るか: dependency-cruiser は @fast-check/vitest を解決できず（knowledge・leafchat と同じ）、依存の種類で拾えない。
      to: {
        path: "(\\.test\\.ts$|^src/test/|^@fast-check/|vitest)",
      },
    },
    {
      name: "unit-tests-use-fakes",
      comment:
        "infrastructure/ の外のテストは infrastructure/ の具象を読まず、src/test のフェイクを注入する。",
      severity: "error",
      from: {
        path: "^src/.+\\.test\\.ts$",
        pathNot: "^src/infrastructure/",
      },
      to: {
        path: "^src/infrastructure/",
        dependencyTypesNot: ["type-only"],
      },
    },
    // Why 使わないか: 公開物は esbuild で 1 ファイルに束ね、実行時の依存を持たない。どの包みも devDependencies に置くので、この規則では層の違反を表せない（上の層の規則で代える）。
    { name: "not-to-dev-dep", severity: "ignore", from: {}, to: {} },
    { name: "no-orphans", severity: "ignore", from: {}, to: {} },
    // Why 外すか: 解決できない import は tsc --noEmit が型の検査で止める（knowledge と同じ）。dependency-cruiser は Node が解決できる @fast-check/vitest も解決できない。
    { name: "not-to-unresolvable", severity: "ignore", from: {}, to: {} },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: { extensions: [".ts", ".js", ".json"] },
  },
};
