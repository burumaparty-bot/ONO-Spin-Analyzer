# ONO Spin Analyzer Ver0.6-CoastPost

700rpm Masterの計測ロジックを変更せず、後段にだけ惰行推定モデルを追加した版です。

## 使い方
1. カメラ起動
2. 計測開始
3. スピナーを回す
4. 700rpm以下まで惰行させる
5. 200rpm付近まで落ちたら停止
6. 推定最大RPMを確認

## 方針
- 計測ロジックは変更しない
- 700rpm以下の実測値だけを低頻度で保存
- 停止後に linear / quadratic / exponential を比較
- R2が最も高いモデルで推定最大RPMを算出
