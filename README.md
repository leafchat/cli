# @leafchat/cli

フォルダに置いた資料（Markdown・PDF・Word など）を、[leafchat](https://leafchat.app) のナレッジに同期するコマンドと GitHub Action です。置いた場所がそのまま leafchat のフォルダになります。どの CI からも、手元からも使えます。GitHub では、pull request に計画をコメントし、`main` への push で反映する Action を使えます（[GitHub Action](#github-action)）。

```bash
npx @leafchat/cli sync check ./knowledge                                            # 送る前の検査だけ（鍵は要らない）
LEAFCHAT_API_KEY=lck_… npx @leafchat/cli sync plan  ./knowledge --source <ソースの ID>  # サーバーの計画を見る（何も変えない）
LEAFCHAT_API_KEY=lck_… npx @leafchat/cli sync apply ./knowledge --source <ソースの ID>  # 変わったファイルを上げて反映する
```

Node.js 22.12 以上が要ります。

## 置き場所の規則

最初の階層のフォルダが leafchat のフォルダ、ファイルがナレッジ、ファイル名が leafchat のファイル名になります。

```txt
knowledge/
├─ よくある質問.md            → ソースの既定の反映先（ふつうは「共通」）
├─ 共通/料金表.pdf            → フォルダ「共通」、ファイル「料金表.pdf」
├─ 渋谷店/営業時間.md          → フォルダ「渋谷店」、ファイル「営業時間.md」
└─ 渋谷店/メニュー/ランチ.pdf   → エラー（leafchat のフォルダは 1 階層だけ）
```

- フォルダは 1 階層までです。2 階層目以降に置いたファイルはエラーになり、同期を止めます
- leafchat に無いフォルダは、サイトごとにナレッジを分けていない組織なら同期のときに作ります。分けている組織では止まるので、ダッシュボードの『ナレッジ』でフォルダを作り、使うサイトを選んでから実行してください
- 名前が `.` で始まるファイルとフォルダ（`.git`・`.github`・`.env` など）、`Thumbs.db`・`desktop.ini`、`~$` で始まる Office の一時ファイルは送りません。シンボリックリンクはたどらず、エラーにします
- ファイル名の空白や `<>:"/\|?*` は、leafchat では `_` になります（`料金表 2026.pdf` → `料金表_2026.pdf`）。置き換えの後で同じフォルダに同じ名前が 2 つあるとエラーです

| 形式 | 拡張子 | 大きさ |
| --- | --- | --- |
| テキスト | `md`・`markdown`・`txt`・`text`・`log`・`json` | 4 MB まで |
| その他 | `pdf`・`docx`・`html`・`htm`・`csv` | 15 MB まで |

- ファイル名は 40 文字まで（回答の出典に出るため）、フォルダ名は 60 文字までです
- 1 つのソースに送れるファイルは 500 件までです
- 対応しない形式（画像・表計算など）は、注意を出して送らずに続けます
- テキスト（md・txt・json）は UTF-8 で保存してください

## API キーの用意

leafchat のダッシュボードの『設定』→『API キー』で、同期のソースを対象にした鍵を発行します。

| 用途 | できること | 向いている場所 |
| --- | --- | --- |
| 同期 | 計画（`plan`）と反映（`apply`）。対象のソースの文書を作成・更新・削除します | main の push で動く CI・手元 |
| 同期の確認 | 計画（`plan`）だけ。ナレッジの本文や会話は読めず、何も書き換えません | pull request の確認 |

鍵は環境変数 `LEAFCHAT_API_KEY` で渡します。コマンドの引数では受けません（シェルの履歴やプロセスの一覧に残るため）。

## 使い方

### `leafchat sync check <dir>`

送る前の検査だけをします。鍵は要りません。問題があれば「どのファイルが・なぜ・どう直すか」を 1 行ずつ出し、終了コード 1 で終わります。

```txt
  x 渋谷店/メニュー/ランチ.pdf：フォルダは 1 階層までです。「渋谷店」の直下へ移してください。
エラーが 1 件あります。直してから、もう一度実行してください。
```

### `leafchat sync plan <dir>`

サーバーに計画（dry-run）を聞いて見せます。何も変えません。

```txt
leafchat の同期の計画  ソース <ソースの ID>

  フォルダの作成    1   新宿店
  作成              2
  更新              1
  名前の変更        1
  移動              0
  削除              1
  変更なし         15
  アップロード      2 件（3.4 MB）

  + 作成        新宿店/営業時間.md
  ~ 更新        共通/料金表.pdf
  > 名前の変更  渋谷店/営業時間.md → 渋谷店/営業時間のご案内.md
  - 削除        渋谷店/旧メニュー.pdf

注意
  ! 渋谷店/営業時間.md：2 つ目の部分が節の途中から始まります（41 行目）。見出しの前で切れるよう、節を短くしてください。
  i フォルダ「新宿店」を作ります。
```

| オプション | 意味 |
| --- | --- |
| `--source <id>` | 同期のソースの ID（環境変数 `LEAFCHAT_SOURCE_ID` でも指定できる） |
| `--json` | 結果を JSON で stdout に 1 つだけ出す |
| `--detailed-exitcode` | 変更があれば終了コード 2 にする |
| `--api-url <url>` | leafchat の API の URL（既定は `https://api.leafchat.app`。環境変数 `LEAFCHAT_API_URL` でも指定できる） |
| `--no-color` | 色を付けない（環境変数 `NO_COLOR` でも止まる） |

### `leafchat sync apply <dir>`

計画を見せて確かめた上で、変わったファイルだけを上げて反映し、取り込みが済むまで待ちます。端末では `y` で進みます。何も変わらないときは聞かずに終わります。

| オプション | 意味 |
| --- | --- |
| `--yes` | 確認を聞かずに反映する。端末でない環境（CI）では必須 |
| `--confirm-delete <path>` | 消してよいファイルのパス（くり返し指定できる） |
| `--confirm-deleted-since <ref>` | この版から git の履歴で消したファイルを、消してよいものとして扱う |
| `--no-wait` | 取り込みが済むまで待たない |
| `--wait-timeout <minutes>` | 取り込みを待つ時間（分。既定は 20） |
| `--source`・`--json`・`--api-url`・`--no-color` | `plan` と同じ |

大きなソースでは、leafchat が 1 回の実行を区切るので、何回かに分けて反映します（途中で止まっても、同じコマンドで続きから実行します）。

## 削除の安全弁

置き場所の設定の誤りで、資料がまとめて消えないようにしています。一度に消す数が、確認なしで消せる数（ソースの資料の 20%・最大 20 件。資料が 5 件より少ないソースでは 0 件）を超えると、`apply` は消すファイルを挙げて止まります。

- 消してよければ `--confirm-delete 渋谷店/旧メニュー.pdf` のように名指しします
- CI では `--confirm-deleted-since <push の前のコミット>` で、git の履歴で消したファイルを確認済みにできます。履歴を読むには、checkout で十分な履歴を取ってください（GitHub Actions なら `fetch-depth: 0`）
- 確かめられない削除が 1 つでもあれば止めます（推測で消しません）
- `plan` は止めずに計画を出し、確認が要る削除に「（確認が要る）」と付けます

## 名前の変更と履歴

ファイルの名前を変えたり別のフォルダへ移したりしても、中身が同じなら、leafchat は同じ文書の名前の変更・移動として扱います。文書の ID と版の履歴が続きます。

名前と中身を同じ同期で変えると、削除と作成になり、履歴が切れます。履歴を保ちたいときは、名前の変更と中身の変更を別々の同期に分けてください。

## GitHub Action

pull request では計画を PR にコメントし、`main` への push で反映します。`uses:` は、版のタグではなく**コミットの SHA で固定**してください（タグは付け替えられるため。SHA は [Releases](https://github.com/leafchat/cli/releases) の各版のコミットで確かめられます）。

### pull request で計画を見る

```yaml
# .github/workflows/leafchat-plan.yml
name: leafchat plan
on:
  pull_request:
    paths: ["knowledge/**"]
permissions: {}
jobs:
  plan:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write # 計画を PR にコメントする
    concurrency:
      group: leafchat-plan-${{ github.event.pull_request.number }}
      cancel-in-progress: true
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
          lfs: true
      - uses: leafchat/cli@<v1.0.0 のコミットの SHA> # v1.0.0
        with:
          mode: plan
          path: knowledge
          source-id: ${{ vars.LEAFCHAT_SOURCE_ID }}
          api-key: ${{ secrets.LEAFCHAT_CHECK_API_KEY }}
```

### `main` への push で反映する

```yaml
# .github/workflows/leafchat-sync.yml
name: leafchat sync
on:
  push:
    branches: [main]
    paths: ["knowledge/**"]
  workflow_dispatch:
    inputs:
      confirm-deletes:
        description: 消してよいパス（1 行に 1 つ）
        required: false
        default: ""
permissions: {}
jobs:
  sync:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    concurrency:
      group: leafchat-sync
      cancel-in-progress: false
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
          fetch-depth: 0
          lfs: true
      - uses: leafchat/cli@<v1.0.0 のコミットの SHA> # v1.0.0
        with:
          mode: apply
          path: knowledge
          source-id: ${{ vars.LEAFCHAT_SOURCE_ID }}
          api-key: ${{ secrets.LEAFCHAT_SYNC_API_KEY }}
          confirm-deletes: ${{ inputs.confirm-deletes }}
```

- **鍵を 2 つに分ける**：PR には書き換えのできない用途「同期の確認」の鍵（`LEAFCHAT_CHECK_API_KEY`）、push には用途「同期」の鍵（`LEAFCHAT_SYNC_API_KEY`）を渡し、PR の workflow から leafchat を書き換えられないようにします
- **フォークからの PR では計画が出ません**：GitHub がフォークからの PR に秘密を渡さないため、送る前の検査だけを行い、理由をジョブの要約に書きます（Dependabot の PR も同じです）
- **`fetch-depth: 0`**：push の前後の git の履歴で消えたファイルを、削除の安全弁の確認済みにするために要ります
- **`lfs: true`**：Git LFS で管理したファイルの実体を取ります（ポインタファイルを送らないため）
- 手軽さを取るなら `uses: leafchat/cli@v1` とも書けます（`v1` は最新の 1.x を指すように付け替えます）。その場合、付け替えた版の中身をそのまま動かすことになります

### 入力と出力

| 入力 | 既定 | 意味 |
| --- | --- | --- |
| `mode` | `plan` | `check`（送る前の検査だけ）・`plan`（サーバーの計画）・`apply`（アップロードと実行） |
| `path` | （必須） | 同期するフォルダ。リポジトリのルートからの相対パス（ワークスペースの外は指せません） |
| `source-id` | | 同期のソースの ID（`plan` と `apply` で必須） |
| `api-key` | | leafchat の API キー（secrets から渡す） |
| `api-url` | `https://api.leafchat.app` | leafchat の API の URL |
| `comment` | `true` | pull request に計画をコメントするか |
| `github-token` | `${{ github.token }}` | PR にコメントするためのトークン |
| `confirm-deletes` | | 削除を確認済みにするパス（1 行に 1 つ） |
| `confirm-deleted-files` | `true` | push の前後で git から消えたファイルの削除を確認済みにするか |
| `wait` | `true` | `apply` のあと、取り込みが済むまで待つか |

| 出力 | 意味 |
| --- | --- |
| `has-changes` | 計画に変更があれば `true`（`check` では `false`） |
| `plan-file` | 計画の JSON（CLI の `--json` と同じ形）を書いたファイルのパス |

### イベントごとの振る舞い

| イベント | `check` | `plan` | `apply` |
| --- | --- | --- | --- |
| `pull_request`（同じリポジトリから） | 検査 | 計画（鍵が無ければ検査） | 失敗（PR では反映しない） |
| `pull_request`（フォークから） | 検査 | 検査（理由を要約に書く） | 失敗 |
| `pull_request_target` | 失敗 | 失敗 | 失敗 |
| `push`・`workflow_dispatch`・`schedule` | 検査 | 計画 | 反映 |

- `pull_request_target` では動きません（PR の中身を、秘密を持つ文脈で扱わないため）
- PR のコメントは、ソースとフォルダの組ごとに 1 つに保ちます（Action が書いたコメントだけを直し、他人のコメントは書き換えません）。件数の表 → 注意 → 1 件ずつ（折りたたみ）の順で、削除があれば表の削除の行が太字になります
- 検査のエラーと注意は、PR の差分の画面の注釈にも出ます
- `apply` は確認を聞かずに反映します（CLI の `--yes` と同じ）。計画は PR のコメントで確かめてください

### Action の版を Dependabot で上げる

SHA で固定した `uses:` は、Dependabot が新しい版の SHA に上げる PR を作ります。

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
    cooldown:
      default-days: 7
```

## 出力と終了コード

- 計画・検査の結果・`--json` の JSON は stdout、進み具合・注意・誤りの文は stderr に出します
- 終了コードは、0 が成功、1 が失敗（検査のエラー・API の誤り・使い方の誤り・確認で「いいえ」）です。`plan --detailed-exitcode` のときだけ、変更があれば 2 です

`--json` の形（`version` は形の版で、変えるときに上げます）：

```json
{
  "version": 1,
  "command": "plan",
  "source_id": "…",
  "ok": true,
  "summary": { "folders_to_create": 1, "create": 2, "update": 1, "rename": 1, "move": 0, "delete": 1, "unchanged": 15, "uploads": 2 },
  "plan": { "…": "サーバーの計画をそのまま" },
  "uploads_required": [],
  "warnings": [],
  "findings": [],
  "inline_skipped": [],
  "deletes_needing_confirmation": [],
  "executed": [],
  "error": null
}
```

失敗したときは `ok` が `false`、`error` が `{ "code": "…", "message": "…" }` になります。GitHub Action の出力 `plan-file` も同じ形です（`check` では `command` が `"check"`、`plan` が `null`）。

## Git LFS

Git LFS で管理したファイルを、LFS の実体を取らずに checkout すると、ポインタファイル（小さなテキスト）を送ってしまいます。CLI はポインタファイルを見分けてエラーにします。GitHub Actions なら `actions/checkout` に `lfs: true` を付けてください。

## よくある誤りと直し方

| 表示 | 直し方 |
| --- | --- |
| フォルダは 1 階層までです | ファイルを最初の階層のフォルダの直下へ移す |
| 同じフォルダに、leafchat で同じ名前になるファイルがあります | どちらかのファイル名を変える |
| ファイル名が 40 文字を超えます | ファイル名を短くする |
| UTF-8 として読めません | 文字コードを UTF-8 にして保存し直す |
| leafchat に無いフォルダがあります | ダッシュボードでフォルダを作り、使うサイトを選ぶ |
| 環境変数 LEAFCHAT_API_KEY に API キーを入れてください | 鍵を環境変数に入れる（引数では受けない） |
| 確認できない環境です | CI では `--yes` を付ける |
| この API キーでは、このソースを同期できません | 用途「同期」の鍵で、このソースを対象にしたものを使う |

## 開発

```bash
pnpm install
pnpm knip && pnpm check && pnpm check-types && pnpm depcruise
pnpm test
pnpm build      # lib/leafchat.js（npm の CLI）と dist/action.js（GitHub Action）を作る
pnpm leafchat sync check ./test/fixtures/knowledge   # ビルドせずに CLI を動かす
```

- **`dist/` はコミットします**。Action はタグの中身をそのまま動かすため、`src/` を変えたら `pnpm build` して `dist/` も一緒にコミットしてください。`check-dist` の workflow が、作り直したものと違えば失敗にします（Dependabot の PR も、手元で `pnpm build` してから入れます）
- `lib/` はコミットしません（npm に公開するときに作ります）
- 公開の手順は [RELEASING.md](RELEASING.md) にあります

## セキュリティ

- 鍵は環境変数だけで受け、表示・ログ・誤りの文には出しません（`***` に置き換えます）
- https だけで通信します（開発用の `http://localhost` を除く）。転送（リダイレクト）はたどりません
- シンボリックリンクはたどらず、ルートの外のファイルを送りません
- 配布物は実行時の依存を持たない 1 ファイルです。install scripts もありません
- GitHub Action で使うときは、版を完全なコミットの SHA で固定してください
- Action は鍵をログで伏せ（`::add-mask::`）、出力・要約・コメントに入れません。`pull_request_target` では動かず、PR のイベントでは反映しません
- npm の包みは GitHub Actions から Trusted Publishing で公開し、provenance（どのコミット・workflow から作ったか）を付けます。npmjs.com の包みの画面で確かめられます（最初の 1.0.0 だけは、包みを作るために手元から公開したので provenance がありません）

脆弱性の報告は [SECURITY.md](SECURITY.md) を見てください。

## ライセンス

[MIT](LICENSE)
