# オフィス素材受け入れメモ

## 取り込み済み素材

### オフィス背景

| 用途 | 元ファイル | 配置先 | サイズ | 透過 |
| --- | --- | --- | --- | --- |
| PC背景 | `/Users/kyoshiro42/Downloads/86研究所オフィス.png` | `public/assets/offices/86-lab-office-desktop.png` | 1672 x 941 | なし |
| スマホ背景 | `/Users/kyoshiro42/Downloads/86研究所オフィスシマホ版.png` | `public/assets/offices/86-lab-office-mobile.png` | 941 x 1672 | なし |

### メンバー素材シート

| メンバー | 元ファイル | 配置先 | サイズ | 透過 |
| --- | --- | --- | --- | --- |
| 丸林勇登 | `/Users/kyoshiro42/Downloads/丸林ドット絵 (1).png` | `public/assets/members/source/marubayashi-yuto-sheet.png` | 1254 x 1254 | あり |
| 谷口強志郎 | `/Users/kyoshiro42/Downloads/谷口ドット絵 (1).png` | `public/assets/members/source/taniguchi-kyoshiro-sheet.png` | 1254 x 1254 | あり |
| 鉢呂元輝 | `/Users/kyoshiro42/Downloads/鉢呂ドット絵 (1).png` | `public/assets/members/source/hachiro-motoki-sheet.png` | 1254 x 1254 | あり |
| 宮部啓史 | `/Users/kyoshiro42/Downloads/宮部ドット絵.png` | `public/assets/members/source/miyabe-keishi-sheet.png` | 1254 x 1254 | あり |
| 鹿島朔人 | `/Users/kyoshiro42/Downloads/鹿島ドット絵.png` | `public/assets/members/source/kashima-sakuto-sheet.png` | 1254 x 1254 | あり |
| 梶田航希 | `/Users/kyoshiro42/Downloads/梶田ドット絵.png` | `public/assets/members/source/kajita-koki-sheet.png` | 1254 x 1254 | あり |

### 切り出し済み個別ポーズ

`scripts/extract-member-sprites.mjs` で、6人分の透過シートから個別ポーズPNGを生成済み。

| メンバー | 出力先 | 主に使う初期ポーズ |
| --- | --- | --- |
| 丸林勇登 | `public/assets/members/marubayashi-yuto/` | `standing-laptop.png` |
| 谷口強志郎 | `public/assets/members/taniguchi-kyoshiro/` | `active.png` |
| 鉢呂元輝 | `public/assets/members/hachiro-motoki/` | `walking-laptop.png` |
| 宮部啓史 | `public/assets/members/miyabe-keishi/` | `active.png` |
| 鹿島朔人 | `public/assets/members/kashima-sakuto/` | `active.png` |
| 梶田航希 | `public/assets/members/kajita-koki/` | `active.png` |

## 現時点の判断

### そのまま使える

- PC用オフィス背景
- スマホ用オフィス背景
- メンバーごとの絵柄、ポーズ案、状態表現の方向性
- 6人分の透過PNG素材シート

### 追加処理が必要

- メンバー素材は透過PNGになったため、背景に自然に重ねられる。
- 6人分のシートは個別PNGへ切り出し済み。
- 今後ポーズ名や使う絵を変える場合は、`scripts/extract-member-sprites.mjs` と `public/assets/office-assets.json` を更新する。

## ユーザーにお願いしたいこと

### 最優先

1. 新しい差し替え素材がある場合は同じ透過PNG形式で用意する。
2. ポーズの割り当てを変更したい場合は、メンバー名と状態名を指定する。
3. 座席位置の好みがある場合は、PC背景とスマホ背景で別々に指定する。

6人分はシート形式で受領・切り出し済み。現在の開発は、この6人分を正規素材として進められる。

推奨ファイル名:

```text
{member-id}-{status}.png
例: marubayashi-yuto-active.png
例: miyabe-keishi-meeting.png
例: kajita-koki-away.png
```

### 次に決めたいこと

1. オフィスに表示するポーズは、座って作業中の絵にするか、立ち絵にするか。
2. 離席中は「キャラを消す」のか「薄く表示する」のか。
3. 会議中は専用ポーズを作るのか、吹き出しバッジで表現するのか。
4. PC背景とスマホ背景で座席位置を完全に別管理してよいか。

## こちらで進められること

### すぐできる

- オフィス背景を既存画面に仮反映する。
- PC用とスマホ用で背景を切り替える。
- 座席座標の初期案を作る。
- 既存の仮キャラ表示を、新しい素材構造に対応できる形へ変更する。
- 透明PNGが届くまで、既存アバターまたは仮キャラで座席配置だけ先に進める。

### 透明PNGが届いたらできる

- メンバー画像をマップ上に自然に重ねる。
- `active` / `away` / `meeting` の状態別表示を適用する。
- 入室、退室、状態変更時の軽い演出を付ける。
- PCとスマホで座標を調整する。

## 初期実装方針

まずは以下の構成で進める。

```text
public/assets/offices/
  86-lab-office-desktop.png
  86-lab-office-mobile.png

public/assets/members/source/
  marubayashi-yuto-sheet.png
  taniguchi-kyoshiro-sheet.png
  hachiro-motoki-sheet.png
  miyabe-keishi-sheet.png
  kashima-sakuto-sheet.png
  kajita-koki-sheet.png

public/assets/members/{memberId}/
  active.png
  away.png
  meeting.png
```

背景は今回取り込んだ2枚を使う。メンバーは透過PNGの素材シートを `source` に保管し、実装では個別PNGへ切り出したものを参照する前提で進める。

現在は `public/assets/office-assets.json` で、PC用背景、スマホ用背景、メンバー別スプライト、PC/スマホ別の初期配置を定義している。

## 座席候補

PC背景では、最初に以下の座席を候補にする。

- ソファ席
- 中央ローテーブル
- 窓側デスク左
- 窓側デスク中央
- 窓側デスク右
- キッチン側カウンター付近

スマホ背景でも同じ意味の席を別座標で定義する。

## 判断メモ

- 背景画像は十分高解像度で、デザインの方向性も現在の `DESIGN.md` に合っている。
- PC版とスマホ版で構図が違うため、座標は共通化せず、レイアウトIDごとに管理した方が安全。
- メンバー画像は絵柄として良く、透過もできている。次は個別切り出しが必要。
- 全パターン画像方式は不要。今回の素材でも、データ合成方式が最適。
