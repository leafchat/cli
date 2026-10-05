# Changelog

この CLI と GitHub Action の変更点です。書き方は [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/)、版の付け方は [Semantic Versioning](https://semver.org/lang/ja/) に従います。

## [1.0.1] - 2026-10-05

### Fixed

- `leafchat sync apply` と GitHub Action（`mode: apply`）：実行の応答を取りこぼして呼び直したとき（leafchat の 1 回の実行が待ち時間を超えたときなど）に、「反映しました」の件数が少なく出て、前の呼び出しで作った文書の取り込みを待たなかった。件数と取り込みの待ち合わせを、計画（dry-run）の作成・更新・名前の変更から組むようにした

## [1.0.0] - 2026-10-05

### Added

- `leafchat sync check <dir>`：送る前の検査（置き場所の規則・形式・大きさ・Git LFS のポインタ・同じ名前）
- `leafchat sync plan <dir>`：サーバーの計画（dry-run）の表示。`--json`・`--detailed-exitcode`
- `leafchat sync apply <dir>`：変わったファイルだけのアップロードと反映・取り込みの待ち合わせ。削除の安全弁の確認（`--confirm-delete`・`--confirm-deleted-since`）
- GitHub Action（`action.yml`・`runs.using: node24`）：pull request では計画を固定のコメントとジョブの要約に書き、検査のエラーを注釈に出す。`main` への push で反映する。フォークからの PR は送る前の検査に落とし、`pull_request_target` と PR のイベントでの反映は拒む。出力 `has-changes`・`plan-file`
- 公開の経路：タグ `vX.Y.Z` で検査してから、承認つきの environment の中で npm に Trusted Publishing で stage する `release` の workflow（npmjs.com での 2 段階認証の承認で公開）。`dist/` を作り直しと比べる `check-dist`、Action を動かす `action-smoke`
