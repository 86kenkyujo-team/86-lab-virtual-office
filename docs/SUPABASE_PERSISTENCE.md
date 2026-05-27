# Supabase 永続化セットアップ

このMVPはローカルでは `data/presence-db.json` で動きます。本番のVercelではJSON書き込みが永続化されないため、更新APIはSupabase未設定時に読み取り専用として扱います。

## 必須環境変数

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY` または `SUPABASE_SERVICE_ROLE_KEY`

`SUPABASE_SECRET_KEY` / `SUPABASE_SERVICE_ROLE_KEY` はサーバー専用です。ブラウザコード、`NEXT_PUBLIC_` 付き変数、GitHub、README、PR本文には載せないでください。

## 初回セットアップ

1. Supabase SQL Editorで `supabase/schema.sql` を実行する。
   `check_in_presence` RPC は `p_qr_token` を検証するため、既存DBへ再適用すると古い4引数版RPCを削除して5引数版へ更新します。
   42501系の権限エラーが出る場合は、SQLを再実行し、Supabase DashboardのData APIで `public` schema が有効になっていることも確認してください。
2. Vercelに環境変数を設定する。

```bash
vercel env add SUPABASE_URL production
vercel env add SUPABASE_SECRET_KEY production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
vercel env add SUPABASE_URL preview
vercel env add SUPABASE_SECRET_KEY preview
vercel env add SUPABASE_SERVICE_ROLE_KEY preview
```

3. ローカル確認用に `.env.local` を作る。

```bash
cp .env.example .env.local
```

4. `.env.local` にSupabase値を入れて、読み取り確認を実行する。

```bash
npm run check:supabase
```

5. テストデータを触ってよい環境だけ、RPC書き込み確認を実行する。

```bash
npm run check:supabase -- --write
```

`--write` は `SUPABASE_CHECK_USER_ID` 未指定時に `taniguchi-kyoshiro` を使い、無効QR拒否、QR入室、ステータス更新、同一モード再入室の冪等性、退室、リモート入室の順にRPCを確認します。最後は対象ユーザーをリモート入室状態へ戻します。

## ローカルで使える状態

Supabaseなしで使う場合は、環境変数を設定せずに以下を実行します。

```bash
npm run dev
```

ブラウザで `http://127.0.0.1:3000` を開き、`/api/health` が `dataSource: "json"` と `persistence.writable: true` を返せば、`data/presence-db.json` へ書き込める状態です。

Supabaseありで使う場合は、`.env.local` に `SUPABASE_URL` と `SUPABASE_SECRET_KEY` または `SUPABASE_SERVICE_ROLE_KEY` を設定してから同じく `npm run dev` を実行します。`/api/health` が `dataSource: "supabase"` と `persistence.writable: true` を返せば、入退室とステータス更新はSupabaseへ保存されます。

## 本番での挙動

- Supabase設定あり: `dataSource` は `supabase`、入室/退室/ステータス更新はPostgresへ保存される。
- Supabase未設定: `dataSource` は `vercel-json`、画面は表示されるが更新APIは `persistent_database_required` を返す。
- ローカル未設定: `dataSource` は `json`、`data/presence-db.json` へ保存される。

## 確認コマンド

```bash
npm test
npm run build
npm run check:supabase
```

Vercelへ反映した後は、本番URLで `/api/health` を確認し、`dataSource: "supabase"` と `persistence.writable: true` になっていることを確認してください。
