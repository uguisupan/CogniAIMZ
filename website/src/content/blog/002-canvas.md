---
title: "CSS変数値をCanvasの描画プロパティに同期させた際のクラッシュバグと回避策"
pubDate: "2026-05-24"
tag: "Canvas2D"
description: "ミリ秒単位で再描画を行うCanvasループ内でCSS変数の値（カスタムプロパティ）を同期させようとした際、特定のブラウザでフレームレートが壊滅的に低下・クラッシュするバグの原因と回避策を解説します。"
---

## 1. バグ発生の経緯：デザインシステムの一元化
Brake Trainerの開発中、UIのデザイン（色調やネオンカラー）をCSSカスタムプロパティ（CSS変数）で管理していました。
どうせなら音ゲーのCanvas（Canvas2D）側の描画色（判定ラインや踏力バー）も、CSSで定義したネオンピンクやシアンの値と完全に同期させ、一元管理したいと考えたのが発端です。

そこで、以下のようなコードをアニメーションループ（毎フレーム実行されるループ）に仕込みました。

```javascript
// ゲームループ内 (毎フレーム実行)
function draw(ctx) {
    // CSSからリアルタイムに色を取得
    const style = getComputedStyle(document.documentElement);
    const neonPink = style.getPropertyValue('--color-pink').trim();
    
    ctx.fillStyle = neonPink;
    ctx.fillRect(0, 0, 100, 100);
}
```

この実装の結果、特定のブラウザ環境でフレームレートが **60fpsから一気に10fps以下に低下** し、最終的にブラウザのタブがクラッシュ（Out of Memory）する現象が発生しました。

---

## 2. 原因：Layout Thrashing (レイアウトスラッシング) の発生
原因は、毎フレーム実行されるループ内で `window.getComputedStyle()` を呼び出していたことにあります。

ブラウザのレンダリングエンジンは、通常「DOMやスタイルの変更」をバッファリングし、次の描画タイミングでまとめて計算します。しかし、JavaScriptから `getComputedStyle` や `getBoundingClientRect` のような「現在の計算されたスタイル/サイズ情報を返すAPI」が呼ばれると、ブラウザは**その瞬間の正しい値を返すために、スタイルの再計算（Recalculation）を同期的に強制実行**します。

これがループ内で実行されると、以下のサイクルが毎フレーム超高速で繰り返されます。
1. **JavaScriptがスタイル情報を要求（getComputedStyle）**
2. **ブラウザが強制的にスタイルの再計算を実行（重い処理）**
3. **描画（Canvas更新）**

この現象は **「Layout Thrashing（レイアウトスラッシング）」** と呼ばれ、特に高負荷な2D/WebGL描画を伴うWebアプリにおいては致命的なパフォーマンスボトルネックとなります。

---

## 3. 回避策：プロパティのキャッシュ化
解決策は非常にシンプルです。毎フレームCSSを読みに行くのをやめ、**初期設定時やテーマ変更時にのみCSS変数の値を読み取ってJavaScript側のメモリにキャッシュ**し、ゲームループ内ではそのキャッシュ（文字列）を直接利用するように修正しました。

```javascript
// グローバル変数にキャッシュ
let colorCache = {
    pink: '#ff007f',
    cyan: '#00f3ff'
};

// 初期化時、またはCSSが変更されたタイミングでのみ実行
function updateColorCache() {
    const style = getComputedStyle(document.documentElement);
    colorCache.pink = style.getPropertyValue('--color-pink').trim() || '#ff007f';
    colorCache.cyan = style.getPropertyValue('--color-cyan').trim() || '#00f3ff';
}

// ゲームループ内 (キャッシュを利用)
function draw(ctx) {
    ctx.fillStyle = colorCache.pink; // 高速
    ctx.fillRect(0, 0, 100, 100);
}
```

この修正により、レイアウト再計算の回数が完全にゼロになり、動作のフレームレートは **安定した60fps（あるいはモニター上限の144fps）** を維持できるようになりました。
「見た目の統一」と「パフォーマンス」の両立には、値の参照タイミングの制御が極めて重要であるという教訓となりました。
