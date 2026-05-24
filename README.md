# 86研究所 仮想オフィス MVP

QR入室とリモート入室を分けて表示する、バーチャル在籍管理MVPです。

## 起動

```bash
npm run dev
```

ブラウザで `http://127.0.0.1:3000` を開きます。

## デプロイ

```bash
npm run build
```

Vercelでは `vercel.json` により `dist` を静的出力として配信し、`api/` 配下をVercel Functionsとして使います。

## データ

- ローカルMVP DB: `data/presence-db.json`
- Supabase移行用スキーマと初期データ: `supabase/schema.sql`
- Supabase接続設定サンプル: `.env.example`

環境変数 `SUPABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY` がある場合、サーバーAPIはSupabase REST/RPCを使います。未設定の場合はローカルJSON DBで動きます。

```bash
cp .env.example .env.local
```

Supabaseを使う場合は、先に `supabase/schema.sql` をSQL Editorなどで実行してください。

## MVPでできること

- 「86研究所」ブランドの仮想オフィス画面を表示
- オフィス勤務とリモート勤務を分けて表示
- メンバー6名の在籍状況を表示
- 操作対象メンバーを切り替えて入退室を試せる
- QR入室、リモート入室、退室をローカルDBへ記録
- 作業中、離席、会議中のステータス更新
- 履歴とタイムラインを表示

## Git運用

ブランチ、PR、レビューの運用ルールは `docs/GIT_WORKFLOW.md` を参照してください。
