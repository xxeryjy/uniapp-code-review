---
name: uniapp-code-review
description: >-
  对 uniapp (Vue 3) 跨端项目进行代码审查，适用于以下场景： (1) PR/MR 的代码审查； (2) 重构前的代码质量评估； (3) 团队代码规范检查； (4) 新人代码指导。 覆盖微信小程序、App (iOS/Android)、H5 多端兼容性检查， 同时兼容 Options API (Vuex) 和 Composition API (Pinia) 两种状态管理模式。 审查完成后按严重度分级给出修改建议。
---

<!-- uniapp-code-review SKILL.md -->

# uniapp 跨端项目 Code Review

## 审查流程

1. **了解上下文** — 确定审查范围（单个文件 / 整个模块 / PR diff），确认目标端（小程序/App/H5/全平台）
2. **逐项检查** — 按下面检查维度逐一审查
3. **输出报告** — 按 **严重 / 建议 / 可选** 三级分级给出修改建议

## 检查维度

### 1. 条件编译正确性

uniapp 条件编译指令 `#ifdef` / `#ifndef` / `#endif` 的使用：

- 平台特有代码是否被正确的条件编译包裹（`APP-PLUS`、`MP-WEIXIN`、`H5` 等）
- 是否有遗漏条件编译导致某端报错
- `#ifndef` 和 `#ifdef` 是否用反（如应该只在非微信小程序的代码用了 `#ifdef MP-WEIXIN`）
- 条件编译块内是否引用了对应端不存在的 API

常见平台标识：

| 标识        | 目标平台          |
| ----------- | ----------------- |
| `APP-PLUS`  | App (iOS/Android) |
| `MP-WEIXIN` | 微信小程序        |
| `H5`        | H5 网页           |
| `MP`        | 所有小程序通用    |

### 2. 跨平台兼容性

- 是否使用了平台特有但未加条件编译保护的 API（如 `plus.*`、`wx.*` 等原生调用）
- `uni` 命名空间 API 本身跨端，但参数差异需检查（如 `uni.showModal` 在 App 和微信小程序的行为差异）
- 第三方 SDK 调用（如推送、蓝牙）是否做了平台判断
- CSS 兼容性：iOS 和 Android 的样式差异处理
- 微信小程序特有的限制：包体积、分包配置、自定义组件注册

### 3. Vue 3 最佳实践

- `script setup` 与 Options API 混用是否合理
- 响应式数据是否使用了 `ref` / `reactive` / `computed` 而非普通变量
- `watch` 和 `watchEffect` 的使用场景是否合理
- 组件生命周期钩子是否正确（`onMounted` vs `mounted` 等）
- `v-for` 是否绑定 `key`
- 模板中是否包含过重逻辑（应放到 computed 或方法中）
- `props` 是否有默认值和类型声明
- `emit` 事件名是否使用 kebab-case 命名规范

### 4. 状态管理

- 状态是否直接从组件内修改（不走 store 的 action）
- Module 拆分是否合理，有无循环依赖
- 持久化存储与 store 数据是否同步（如 `uni.getStorageSync` 与 store state 的一致性）

> 状态管理框架（Pinia / Vuex）的具体检查项由项目配置决定，以审查任务中给出的“本项目配置”为准。

### 5. API 请求与错误处理

- 请求是否统一走封装的 request 模块而非裸 `uni.request`
- 异常捕获是否遗漏（有无 `try/catch` 或 `.catch()`）
- 加载状态（loading / error / empty）是否处理完整
- Token 过期刷新逻辑是否正确
- 接口响应结构校验（`res.code == 200` 等模式是否一致）

### 6. 国际化（i18n）

- 用户可见的文本是否使用 `$t()` / `t()` 而非硬编码字符串
- 动态文本拼接是否通过 `$t('key', { param })` 参数替代
- 日期、时间格式化是否使用 i18n 的格式化函数

### 7. 性能

- 长列表是否使用虚拟列表或分包
- `setInterval` / `setTimeout` 是否在 `onHide` / `onUnload` 中清理
- 不必要的 `watch` 或计算属性重计算
- 图片资源是否懒加载，尺寸是否合理
- 页面级 `onShow` / `onHide` 中是否有重型同步操作
- 条件编译块内是否有重复的逻辑执行

### 8. 安全

- Token / 敏感信息是否明文存储在 Storage
- 用户输入是否有 XSS 防护或长度校验
- URL 参数拼接是否使用 encodeURIComponent
- 小程序 `web-view` 的 URL 是否经过白名单校验
- 蓝牙 / 通讯数据是否有加密处理

### 9. 代码风格与注释

- 是否符合项目的 Prettier / ESLint / Stylelint 配置（见 `.prettierrc`、`.eslintrc.js`、`.stylelintrc.cjs`）
- 注释编码是否规范：中文注释所在文件必须是 UTF-8 编码，不能出现因 GBK 等非 UTF-8 编码导致的乱码；英文注释内容必须为英文；任何注释都不能出现 `???`、`�`、`锟斤拷` 等乱码
- 注释是否过时、误导或与代码逻辑矛盾
- 被注释掉的死代码是否应删除而非遗留
- 变量 / 函数命名是否语义化

## 修改建议输出格式

严格按同目录 `output-contract.md` 的输出格式契约输出：三级章节标题、字段名与整体结构均为硬契约，不可更改。

要点：无严重问题时**整节省略** `### 严重`；每条问题的 `文件位置` 统一写成 `相对路径:行号`。

## 参考文档

uniapp 条件编译的详细语法和常见模式参见 `references/conditional-compilation.md`。在审查时遇到不明确的 uniapp API 差异，请参考该文件。
