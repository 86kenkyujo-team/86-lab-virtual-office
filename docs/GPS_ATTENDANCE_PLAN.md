# GPS連携による勤務開始方針

作成日: 2026-05-27

## 結論

QRコードを廃止して「オフィス出社はGPS、リモートはボタン」にする方針は可能。ただし、ブラウザだけで「スマホが事務所に着いた瞬間、アプリを開いていなくても自動開始」は現実的ではない。

実現ルートは2段階がよい。

1. まずWeb/PWAで「オフィスで開始」ボタンを作る。
   - ユーザーがスマホでボタンを押す。
   - ブラウザのGeolocation APIで現在地を取得する。
   - 事務所の緯度経度と半径内なら勤務開始にする。
   - リモートは従来通り「リモート開始」ボタン。
2. 自動開始が必要になったら、iOS/AndroidネイティブのGeofenceへ進む。
   - iOS: Core Locationのregion/condition monitoring。
   - Android: Geofencing API。
   - 入域時にアプリがイベントを受け、サーバーへ勤務開始をPOSTする。

## なぜブラウザだけでは限界があるか

WebのGeolocation APIは、HTTPSなどの安全なコンテキストとユーザー許可が必要。`getCurrentPosition()` で現在地を取得し、`watchPosition()` で位置変化を監視できるが、基本的にはWebページ/ブラウザが動いている前提になる。

Service Workerはオフライン、キャッシュ、Push、Background Syncなどには使えるが、位置情報をバックグラウンドで常時監視する仕組みとしては使いにくい。つまり「スマホをポケットに入れて事務所に入ったら、Webアプリが勝手に勤務開始」はブラウザだけでは期待しない方がよい。

## 公式情報ベースの実現性

- MDN Geolocation API
  - https://developer.mozilla.org/en-US/docs/Web/API/Geolocation_API
  - HTTPSなどのsecure contextが必要。
  - ユーザーの明示的な許可が必要。
  - `getCurrentPosition()` と `watchPosition()` が使える。
- Apple Core Location region monitoring
  - https://developer.apple.com/documentation/CoreLocation/monitoring-the-user-s-proximity-to-geographic-regions
  - iOSは地理的条件の入退出を監視でき、条件変化時にアプリを起こせる。
  - 1アプリあたり監視条件は最大20。
- Android Geofencing API
  - https://developer.android.com/training/location/geofencing
  - 緯度、経度、半径でGeofenceを作り、enter/exit/dwellイベントを受け取れる。
  - 1アプリ/ユーザーあたり最大100 Geofence。
  - Android 8以降のバックグラウンドでは反応が数分遅れることがある。

## 推奨する勤務開始フロー

### オフィス出社

初期実装:

1. スマホで86研究所の画面を開く。
2. 「オフィスで開始」を押す。
3. 位置情報の許可を求める。
4. 取得した位置が事務所の半径内なら勤務開始。
5. 半径外、精度不足、取得失敗の場合は開始せず理由を表示。

将来の自動実装:

1. 事前にアプリ/PWA相当でバックグラウンド位置情報を許可する。
2. 事務所をGeofenceとして登録する。
3. 事務所に入ったら端末側で入域イベントを受ける。
4. サーバーへ `gps_geofence` として勤務開始をPOSTする。
5. 必要なら通知で「86研究所に到着しました。勤務開始しました」と出す。

### リモートワーク

1. 「リモート開始」ボタンを押す。
2. `entry_method = remote_manual` として勤務開始。
3. 位置情報は不要。

## データモデル変更案

### offices

- `latitude`
- `longitude`
- `geofence_radius_meters`
- `gps_required`
- `timezone`

### attendance_sessions

- `entry_method`
  - 既存: `office_qr`, `remote_manual`, `admin_edit`, `auto_timeout`
  - 追加候補: `office_gps_manual`, `office_gps_geofence`
- `location_accuracy_meters`
- `location_checked_at`
- `location_verification_status`
  - `verified`
  - `outside_radius`
  - `low_accuracy`
  - `permission_denied`

### presence_events

- `actor_user_id`
- `event_type`
  - `office_gps_in`
  - `office_gps_denied`
  - `remote_in`
  - `checkout`
- `metadata`
  - 緯度経度の生値は原則保存せず、必要なら丸める。

### device_registrations

自動Geofenceをやる場合のみ。

- `user_id`
- `device_id`
- `platform`
- `push_token`
- `background_location_granted`
- `last_seen_at`

## API案

### `POST /api/presence/office-gps`

リクエスト:

```json
{
  "userId": "taniguchi-kyoshiro",
  "latitude": 34.000000,
  "longitude": 135.000000,
  "accuracy": 25,
  "capturedAt": "2026-05-27T10:00:00+09:00"
}
```

サーバー側検証:

- ユーザーが本人か確認。
- `capturedAt` が古すぎないか確認。
- `accuracy` が許容範囲内か確認。例: 100m以下。
- 事務所座標からの距離が `geofence_radius_meters` 内か確認。
- OKなら `workMode = office`, `entryMethod = office_gps_manual` で開始。

### `POST /api/presence/remote`

リクエスト:

```json
{
  "userId": "taniguchi-kyoshiro"
}
```

サーバー側処理:

- `workMode = remote`
- `entryMethod = remote_manual`
- 位置情報は要求しない。

## UI変更案

- 「QRでオフィス入室」ボタンを「オフィスで開始」に変更。
- 「入退室QR」ボタンとQRダイアログを削除。
- オフィス開始時に位置情報許可ダイアログを出す。
- 許可前は「位置情報を許可して開始」。
- 許可済みは「現在地を確認中」→「オフィス勤務を開始しました」。
- 半径外は「事務所付近でのみ開始できます」。
- 精度不足は「位置情報の精度が不足しています。少し待って再試行してください」。
- 設定画面に「事務所GPS範囲」「GPS勤務開始方式」を表示。

## セキュリティとプライバシー

- 位置情報は勤務開始判定にだけ使い、常時トラッキングしない。
- 生の緯度経度は保存しないか、保存する場合は丸める。
- 「誰がいつオフィス勤務を開始したか」は残すが、「移動経路」は残さない。
- 本人の明示的な同意を取る。
- 管理者が代理で状態変更した場合は `actor_user_id` を残す。
- GPSは偽装可能なので、厳密な勤怠証跡にするならWi-Fi、端末認証、管理者確認などと組み合わせる。

## 実装ステップ

### Step 1: QR廃止のUI準備

- QRボタン、QRダイアログ、`/scan/:token` 導線を削除または非表示。
- オフィス開始ボタンをGPS開始に置き換える。
- `entry_method` に `office_gps_manual` を追加。

### Step 2: Web版GPS開始

- フロントで `navigator.geolocation.getCurrentPosition()` を使う。
- サーバーで距離計算してオフィス範囲内か判定。
- 範囲外/精度不足/権限拒否の表示を作る。

### Step 3: リモート開始API整理

- 既存の `/api/presence` でも動くが、将来的には `/api/presence/remote` に分ける。
- リモートは位置情報不要にする。

### Step 4: Supabase反映

- `offices` に緯度経度と半径を追加。
- `entry_method` enumを拡張。
- RPCをGPS用に追加。

### Step 5: 自動Geofence

- 必要性が固まってからネイティブアプリ、Capacitor、React Native、Expoなどを検討。
- iOS/Androidでバックグラウンド位置情報許可を取る。
- 入域時にサーバーへPOSTする。

## まず作るべきMVP

最初から完全自動を狙うより、まずは「オフィスで開始」ボタン + GPS判定がよい。これなら現在のWeb構成を大きく壊さずに実装できる。

最小仕様:

- 事務所座標と半径を `data/presence-db.json` と Supabase schema に追加。
- QR関連UIを非表示。
- オフィス開始ボタン押下時に現在地取得。
- 半径内ならオフィス勤務開始。
- リモート開始はボタンのみ。
- 位置情報を保存しすぎない。
