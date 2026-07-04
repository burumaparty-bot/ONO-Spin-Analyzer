# ONO Spin Analyzer Ver0.1.2

## 目的
ONO Dino Generator から計測部分を切り離し、ハンドスピナーの回転速度計測だけを確認するための解析用プロトタイプです。

## 方針
- Ver0.1.1系の安定計測ロジックをベースにする
- ゲーム要素は入れない
- まずは 667rpm 付近で破綻する原因をログで確認する
- 1000rpm対応に向けて、以後は一つずつ変更する

## GitHub Pagesへの反映方法
1. ZIPを展開する
2. 中にある `index.html` と `README.md` を GitHub リポジトリ直下へアップロードする
3. GitHub Pages を開く  
   https://burumaparty-bot.github.io/ONO-Spin-Analyzer/?v=012

## 注意
リポジトリ直下に `index.html` が必要です。
フォルダごとアップロードするとトップURLでは表示されません。
