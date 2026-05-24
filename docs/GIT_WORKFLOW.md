# Git / PR 運用ルール

## ブランチ構成

- `main`
  - 本番デプロイ用ブランチ。
  - Vercel Production と連携する。
  - 直接コミットせず、原則PR経由で更新する。
- `develop`
  - 次回リリース候補をまとめる統合ブランチ。
  - Vercel Preview と連携する。
  - 小さなMVP段階では省略可能だが、複数機能が並行したら必ず使う。
- `feature/*`
  - UI追加、機能追加、データ設計追加など通常作業用。
- `fix/*`
  - バグ修正用。
- `chore/*`
  - 設定、依存、ドキュメント、デプロイ整備用。
- `hotfix/*`
  - 本番障害や緊急修正用。`main` から切り、修正後 `main` と `develop` に戻す。

## ブランチ命名

```text
feature/office-map-interactions
feature/supabase-auth
fix/mobile-overflow
chore/vercel-deploy
docs/git-workflow
hotfix/production-api-error
```

命名ルール:

- 英小文字、数字、ハイフンのみ。
- 目的が分かる短い名前にする。
- 1ブランチ1目的を守る。

## 作業開始手順

1. `main` を最新化する。
2. 必要なら `develop` を最新化する。
3. 作業ブランチを作成する。

```bash
git switch main
git pull
git switch -c feature/example
```

`develop` 運用中は以下。

```bash
git switch develop
git pull
git switch -c feature/example
```

## コミット方針

- 1コミット1意図を基本にする。
- 迷ったら小さく分ける。
- Supabaseキー、Vercelトークン、`.env.local` は絶対にコミットしない。

推奨プレフィックス:

```text
feat: 機能追加
fix: バグ修正
chore: 設定・運用
docs: ドキュメント
style: 見た目調整
refactor: 挙動を変えない整理
```

## PR作成手順

1. 作業ブランチで実装する。
2. ローカル確認を行う。
3. `git status --short` で差分を確認する。
4. コミットする。
5. GitHubへpushする。
6. PRを作成する。
7. Vercel Preview URLでPC/スマホを確認する。
8. レビュー対応後にmergeする。

## PR単位

PRは以下の粒度に分ける。

- UIだけの変更
- APIだけの変更
- DBスキーマだけの変更
- デプロイ設定だけの変更
- 文書だけの変更

UIとDBのように影響範囲が大きい場合は、できるだけ別PRにする。

## レビュー体制

### 人間の担当

- 最終判断者: オーナーまたはプロジェクト責任者。
- 実装担当: Codexまたは開発担当者。
- マージ担当: 最終判断者。小規模修正は実装担当が代行可。

### サブエージェントレビュー

サブエージェントレビューを依頼する担当:

- 通常は実装担当のCodexが、PR作成前またはPR作成後にレビュー観点を整理する。
- 人間の最終判断者が「レビューして」と依頼した場合、Codexがサブエージェントレビューを実行する。
- サブエージェントの指摘は判断材料であり、merge可否の最終判断は人間が行う。

レビュー観点:

- UI崩れ、スマホ表示、テキスト重なり
- QR入室、リモート入室、退室の状態遷移
- Supabase接続時に秘密情報が漏れないこと
- Vercel Preview / Production の表示確認
- 不要な画像、`.env`、`.vercel`、`dist` が含まれていないこと

## マージルール

- `main` へのmerge前にVercel Previewを確認する。
- `main` にmerge後、Vercel ProductionがReadyになることを確認する。
- 本番URLで `/` と `/scan/86-lab-office-main` を確認する。
- Supabase未接続状態では `dataSource` が `vercel-json` または `json` であることを確認する。

## Supabase接続再開ルール

Supabase接続作業は `feature/supabase-auth` または `feature/supabase-persistence` で再開する。

再開時に確認するファイル:

- `.env.example`
- `supabase/schema.sql`
- `api/_lib/store.js`
- `server.mjs`

本番接続では `SUPABASE_SERVICE_ROLE_KEY` をVercel環境変数にのみ設定し、ブラウザに公開しない。
