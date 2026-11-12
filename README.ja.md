# WizTree MCP

[日本語](./README.ja.md) | [English](./README.md)

WindowsはWizTree、Macはメタデータの読み取り専用走査で容量を分析します。
既存の英語・日本語WizTree CSVも分析できます。スキャン対象は変更しません。

## CSVを増やさない運用

**Windows・Macとも通常スキャンではCSVを永続保存しません。**
`scan_path`の返す`csvPath: "scan:<id>"`を、top・drilldown・拡張子別・oldlarge・
検索・比較などの既存分析ツールに渡せます。最新1回だけメモリに保持し、
次の成功したスキャンで置き換わります。失敗時は前の結果を保持し、再起動では失効します。

WindowsのWizTreeはCSV出力が必要なので、処理専用の一時ディレクトリを作り、
プロセス終了後にCSVを解析・treemapを読み取ってから`finally`で破棄します。
成功・出力失敗・解析失敗・キャンセル・タイムアウトで後始末し、
自分がその処理で作った一時ディレクトリだけを削除します。
Macの通常走査はCSV自体を書きません。既存ユーザーCSVや古い`exports/`は自動削除しません。
強制終了・電源断では`finally`が動かず一時ファイルが残り得ます。起動時の一括削除はしません。

比較などで意図的に残す場合だけ、保存先と名前をすべて指定します。

```json
{
  "targetPath": "/Users/you/Documents/example",
  "saveSnapshot": true,
  "snapshotDirectory": "/Users/you/Documents/chosen-snapshots",
  "snapshotName": "baseline.csv"
}
```

保存先は絶対パス、名前は英数字・ドット・アンダースコア・ハイフンからなる`.csv`名です。
日時やUUID付きの永続ファイル名を自動生成しません。同名が存在すれば`EEXIST`で失敗し、
既存ファイルを上書き・削除しません。1件32 MiB、保存先直下の通常ファイルとの合計128 MiBまで。
同じプロセス内の保存処理を直列化します。複数サーバーから同じ保存先への同時書込みは避けてください。
Windowsでは元のCSVを保持し、Macでは互換英語ヘッダーで保存します。

## 互換性の変更点

- 旧Windows版の`scan_path`は`exports/`に日時付きCSV/PNGを保存しました。今後の標準戻り値はメモリhandleです。永続パスが必要な呼出し元は明示保存に更新してください。
- Macの`saveSnapshot: true`も保存先・名前なしでは受け付けません。
- Windowsのtreemapはその場で画像として返し、一時PNGを破棄します。新しい永続`treemapPath`は返しません。
- 表には論理サイズ・割当サイズを表示します。CSV単体解析は20万行、スキャンは標準10万・最大20万件に制限します。
- Windowsの既存フィルタ、除外、ソート、admin、ファイル/フォルダ選択は維持します。

## 起動と削除ツール

Node.js 22以上で、`npm ci --ignore-scripts`、`npm run build`、`node dist/index.js`。
ビルド後は`npm run print-config`が、絶対パスとtimeoutを埋め込んだ登録設定を出力します。
Mac登録案は次の環境変数で既存のスナップショット削除ツールを非公開にします。

```toml
[mcp_servers.wiztree.env]
WIZTREE_MCP_DISABLE_CLEANUP = "1"
```

このモードでは`cleanup_snapshots`が`tools/list`に出ず、直接呼出しも拒否します。
変数未指定時は旧ツールの公開動作を維持します。旧cleanupは指定exportディレクトリ内の
CSV/PNGを削除する機能で、既存ファイルの所有者は判定しません。
通常スキャンの一時ファイル破棄は、この変数に関係なく行います。
`WIZTREE_MCP_EXPORT_DIR`は旧list/cleanupの対象だけを設定し、明示保存先にはなりません。
登録例・全ツール一覧は[README.md](./README.md)を参照してください。
その文書では`<...>`表記がすべてプレースホルダ（実パスではない）だと明記しています。
手入力の代わりに`npm run print-config -- --client codex`を使えば置換は不要です。

**許可ルート設定は未実装です。** プロセスが読める任意のフォルダを指定でき、
CSV読取はプロセスが読める任意のパスを許容します。`get_treemap`（PNGのみ）は
exportディレクトリ内の`.png`に限定しました。明示保存先も任意の書込み可能ディレクトリです。
Macの`/`・symlink対象拒否は許可リストの代わりになりません。登録前にアクセス範囲を合意する必要があります。

## Macの制約

外部symlink・別マウントを除外し、権限エラー等は部分結果として報告します。
キャンセル・時間・件数上限では結果を公開しません。実行中のファイルシステム呼出し完了後にキャンセルを認識します。
論理サイズは`st_size`、割当サイズは`st_blocks * 512`です。ハードリンクはパスごとに計上します。
APFS共有領域・圧縮・スナップショット等を反映した「削除で回復する容量」は算出できません。
走査中の悪意あるパス差し替えに対する完全な隔離は保証しません。
MacではWizTree固有のadmin・フィルタ・sort・実行パス・treemap指定を拒否します。

## 検証記録
型チェック・ビルド・37件のfixtureテストでMac実stdio分析、Windows mock/小型Node子プロセスの
成功・失敗・解析失敗・キャンセル・タイムアウトと一時CSV cleanup、既存CSV保持、
明示保存・上限・重複拒否、削除無効時のtool一覧を確認しました。
Windows実機で一度だけ手動スモークを実施し、登録済みstdioセッションが11ツールを列挙し、
導入済みの`WizTree64.exe`で小さい実ディレクトリを走査し、`get_treemap`の範囲外指定を
拒否する点を確認しました。UAC昇格、ハング時taskkill、macOS実機、ユーザーデータの削除は未検証です。
ネイティブ依存は追加していません。
ツール引数は`tools/list`のschema名が正しい（`scan_path`は`targetPath`であって`path`ではなく、深さ指定の引数は無い）。
文字列化されたスカラー（`"true"`・`"5000"`）は受理し、曖昧な値（`"yes"`）はパラメータ名を挙げて拒否します。
公開するschemaは单一型のまま変わりません。
WizTreeがGUIインスタンスの索引占有でヘッダー行だけを書き退出コード0で終わる場合、1回だけ自動再試行します
（同一スイッチ・同一対象）。2回目も空ならエラー、解析系の他の失敗は再試行しません。
`search_entries`はファイル合計とフォルダ格納合計を分けて報告します（フォルダ行は子孫を含むため、
合算すると同じ領域を重複計上する）。回収できるのはファイル合計だけです。
`list_snapshots`は既定のexport目録以外にも`snapshotDirectory`で一覧できます。保存先を指定した場合、
ここで指定し直さないと表示されません（返されたパスはそのまま`csvPath`に使えます）。

## 依存監査の修復

既存semver範囲の間接依存7件を更新し、critical/highは0件になりました。
`npm audit --audit-level=high`、型検査・build・37テストが通っています。
新規パッケージ名とCI監査基準は変更していません（直接依存の宣言変更は下記の2巡目だけ）。
具体的な深刻度・修正版・更新差分は[英語READMEの表](./README.md#dependency-audit-follow-up)を参照してください。

残りは`csv-parse`のmoderateと`body-parser`のlowです。

## 依存監査の2巡目

新しい公告2件でhighゲートが再び落ちたため追補しました：`body-parser`（high）と
`zod`（high、`zod <4.6.6`、GHSA-mrhx-c7xc-m3w5）です。`zod`の3.xに修正版がないため、
直接依存を`^4.6.7`へ上げました。`@modelcontextprotocol/sdk` 1.32は`zod: ^3.25 || ^4.0`、
`zod-to-json-schema` 3.25.2は`^3.25.28 || ^4`を許可し、解決ツリーのzodは1つだけです。
型検査だけでなく実stdioで、11ツールのdefault・enum・description・数値上限がそのまま
出力されることを確認済みです。詳細な表は英語READMEの「Second pass」にあります。
前者はメジャー更新、後者は新しい入れ子の`content-type` 2.x依存が必要なため別途レビューに保留しました。
監査を無効化したり、`npm audit fix --force`を使用したりしていません。

## License

MIT. See [LICENSE](./LICENSE).
