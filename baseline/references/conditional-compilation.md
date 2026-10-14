# uniapp 条件编译参考

## 条件编译语法

### 基本语法

```js
// #ifdef APP-PLUS
// 仅在 App 端编译的代码
console.log('this is app');
// #endif

// #ifndef MP-WEIXIN
// 非微信小程序端编译的代码
console.log('not weixin mini program');
// #endif

// #ifdef H5 || MP-WEIXIN
// H5 或微信小程序端编译的代码（多条件或）
console.log('h5 or weixin');
// #endif
```

### 可用平台标识

| 标识            | 说明              |
| --------------- | ----------------- |
| `APP-PLUS`      | App (iOS/Android) |
| `APP-PLUS-NVUE` | App nvue          |
| `H5`            | H5 网页           |
| `MP-WEIXIN`     | 微信小程序        |
| `MP-ALIPAY`     | 支付宝小程序      |
| `MP-BAIDU`      | 百度小程序        |
| `MP-TOUTIAO`    | 头条小程序        |
| `MP-QQ`         | QQ 小程序         |
| `MP`            | 所有小程序通用    |

### 逻辑组合

- `#ifdef` — 仅在某平台存在时编译
- `#ifndef` — 在某平台不存在时编译
- 多条件：`#ifdef APP-PLUS || H5`（或），`#ifdef APP-PLUS && H5`（与）

## 常见场景模式

### 1. App 端使用原生 API

```js
// #ifdef APP-PLUS
plus.runtime.openURL(url);
plus.push.getClientInfo();
// #endif
```

### 2. 微信小程序使用小程序特有 API

```js
// #ifdef MP-WEIXIN
wx.getUpdateManager();
wx.getAccountInfoSync();
// #endif
```

### 3. 非小程序端隐藏 TabBar

```js
// #ifndef MP-WEIXIN
uni.hideTabBar({ animation: false });
// #endif
```

### 4. H5 端额外处理

```js
// #ifdef H5
window.addEventListener('...');
// #endif
```

### 5. 仅 App 端执行蓝牙操作

```js
// #ifdef APP-PLUS
uni.openBluetoothAdapter({...});
// #endif
```

## 常见陷阱

### 1. 条件编译注释只能写在一行

```js
// ✅ 正确
// #ifdef APP-PLUS
console.log('app');

// ❌ 错误
/* #ifdef APP-PLUS */
console.log('app');
/* #endif */
```

### 2. 条件编译不能包裹 import 语句（部分场景）

在 `<script>` 顶部，import 只能写在条件编译块外。如需条件引入，需在代码内部动态 require。

### 3. 模板中的条件编译

```html
<!-- #ifdef APP-PLUS -->
<view class="app-only">仅在 App 显示</view>
<!-- #endif -->
```

### 4. 样式中的条件编译

```css
/* #ifdef APP-PLUS */
.app-only {
  color: red;
}
/* #endif */
```

### 5. 微信小程序不存在 DOM/BOM API

```js
// ❌ 会报错
document.getElementById('xxx');

// ✅ 使用 uni 的 API 或加条件编译
// #ifdef H5
document.getElementById('xxx');
// #endif
```
