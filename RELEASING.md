# 公開の手順

CLI（npm の `@leafchat/cli`）と GitHub Action（Marketplace の `leafchat/cli`）を、**同じタグ** `vX.Y.Z` で公開します。npm への公開は `release` の workflow が行い、GitHub の Release と Marketplace への掲載は人が行います。

| 経路 | 守り |
| --- | --- |
| npm | Trusted Publishing（OIDC。長期のトークンを置かない）・provenance（1.0.1 から）・承認つきの environment `release`・包みの設定で「トークンを禁じる」 |
| GitHub | Immutable releases（公開した Release のタグは動かせない）・タグの ruleset・`uses:` の SHA の固定・`dist/` の作り直しとの比較（`check-dist`） |

## 最初の 1 回だけ

Trusted Publishing（`npm trust` を含む）も staged publishing も、包みが npm に既にあることが要ります。そのため、**最初の版の 1.0.0 だけは手元から出します**（準備用の版は作りません。2026-10-05 に決めた）。1.0.0 には provenance が付かず、1.0.1 以降は workflow から provenance つきで出ます。

### 1. GitHub（`leafchat/cli` の Settings）

- **General → Releases**：「Enable release immutability」を有効にします
- **Environments → New environment `release`**（最初のタグを push する前に作ります。無い environment を参照する workflow が動くと、保護ルールなしの environment が自動でできるため）
  - Required reviewers：持ち主（1 人なので「Prevent self-review」は付けません）
  - 「Allow administrators to bypass configured protection rules」を外します
  - Deployment branches and tags：「Selected branches and tags」で、タグの `v*.*.*` だけを足します
  - Environment secrets・variables は置きません
- **Rules → Rulesets**
  - ブランチ `main`：pull request を必須・必須の検査（`check`・`check-dist`・`action-smoke`・`zizmor`・`analyze (javascript-typescript)`・`analyze (actions)`。1 度 workflow が動くと選べます）・force push を禁止
  - タグ `v*`：作成・更新・削除を制限し、bypass は持ち主（Repository admin）だけにします
- **Actions → General**
  - 「Require actions to be pinned to a full-length commit SHA」を有効にします（`uses: ./` は対象外です）
  - Workflow permissions は「Read repository contents and packages permissions」にし、「Allow GitHub Actions to create and approve pull requests」を外します
- **Code security**：Secret scanning と push protection・Private vulnerability reporting・Dependabot alerts を有効にします（Code scanning の「Default setup」は有効にしません。`codeql.yml` とぶつかるため）
- **Marketplace**：持ち主のアカウント（2 段階認証）で、GitHub Marketplace の開発者の契約に同意します。あわせて、[Marketplace](https://github.com/marketplace?type=actions) で `action.yml` の `name`（`leafchat knowledge sync`）と同じ名前の Action が無いことを確かめます（あれば `name` を変えて、`dist/` と一緒にコミットします）

### 2. 1.0.0 を手元から npm に出す

1. **release の PR**：`CHANGELOG.md` の `## [Unreleased]` を `## [1.0.0] - 公開する日` にする → PR を作り、検査が通ったらマージします（`package.json` の `version` は既に `1.0.0`）
2. **手元で、マージした `main` から作り直して出す**（タグを付けるコミットと同じ中身を出すため）

   ```bash
   cd leafchat/cli
   git switch main && git pull --ff-only
   git status --short                 # 何も出ないこと
   pnpm install --frozen-lockfile
   pnpm build
   git status --short -- dist/        # 何も出ないこと（dist/ がコミットと同じ）
   pnpm pack
   tar -tzf leafchat-cli-1.0.0.tgz    # package/lib/・package.json・README.md・LICENSE・CHANGELOG.md だけ
   npm login                          # 2 段階認証
   npm publish ./leafchat-cli-1.0.0.tgz --access public
   rm leafchat-cli-1.0.0.tgz
   npx @leafchat/cli@1.0.0 --version  # 1.0.0
   ```

### 3. npm の包みの設定（npmjs.com の `@leafchat/cli` → Settings）

- **Trusted Publisher**：GitHub Actions・Organization or user `leafchat`・Repository `cli`・Workflow filename `release.yml`・Environment name `release`。許す操作に **`npm publish`** を選びます（新しい設定の既定は stage publish だけのため）
- **Publishing access**：「Require two-factor authentication and disallow tokens」

### 4. タグ・Release・Marketplace

「毎回」の 2〜6 を、`X.Y.Z` を `1.0.0` にして行います。1.0.0 は npm に既にあるので、`publish-npm` は承認すると公開を飛ばして成功します（4 の provenance の確認は 1.0.1 から）。

## 毎回（`vX.Y.Z`。1.0.1 から）

1. **release の PR**：`package.json` の `version` を上げる → `pnpm build`（`dist/` が変わる）→ `CHANGELOG.md` の `## [Unreleased]` を `## [X.Y.Z] - 公開する日` にする → PR を作り、検査が通ったらマージします
2. **タグ**：`main` の最新のコミットに `vX.Y.Z` を付けて push します

   ```bash
   git switch main && git pull --ff-only
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin vX.Y.Z
   ```

3. **承認**：`Release` の workflow の `publish-npm` が承認を待ちます。`verify` が通っていることを見て承認します
4. **npm を確かめる**：npmjs.com の `@leafchat/cli` に `X.Y.Z` が出て、provenance（「Built and signed on GitHub Actions」）が付いていることを確かめます
5. **Release と Marketplace**：GitHub の Releases → Draft a new release → タグ `vX.Y.Z` → 「Publish this Action to the GitHub Marketplace」にチェック → 分類（Continuous integration・Utilities）→ 本文に CHANGELOG の該当の節を貼る → Publish release（Immutable なので、後からタグは動きません）
6. **動くタグを付け替える**（`v1` には Release を作りません）

   ```bash
   git tag -f v1 "vX.Y.Z^{}"
   git push -f origin v1
   ```

## うまくいかないとき

| 症状 | 確かめること |
| --- | --- |
| `verify` の「Check that the tag matches package.json」で落ちる | タグと `package.json` の `version` がそろっているか（タグを消して付け直すより、版を上げて出し直す） |
| `verify` の「Check that dist/ is the committed one」で落ちる | release の PR で `pnpm build` した `dist/` をコミットしたか |
| `publish-npm` が 404・403 で落ちる | Trusted Publisher の設定（リポジトリ・`release.yml`・environment `release`・`npm publish` を許す）が合っているか |
| `publish-npm` を再実行したい | そのまま再実行できます（npm に同じ版があれば公開を飛ばします） |
| 公開した版に誤りがあった | npm の版は消さずに `npm deprecate` し、直した版（`X.Y.Z+1`）を出します。Immutable なので、同じタグの付け直しはできません |
