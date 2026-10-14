# @wenshanhu/uniapp-code-review

uniapp 跨端项目的 AI 代码审查基线。配合 `git commit` 门禁使用：

- **基线规则跨项目共用**（本包内置 `baseline/`）；
- **项目差异通过配置声明**（各项目的 `code-review.config.json`）；
- 审查结论**只作建议**，是否阻断由项目的 `blockStrategy` 决定。

## 安装

以 git 依赖方式安装为 devDependency（用 `#semver:` 指定版本范围）：

```bash
npm i -D "github:xxeryjy/uniapp-code-review#semver:^1.0.0"
```

对应的 `package.json` 声明：

```json
"@wenshanhu/uniapp-code-review": "github:xxeryjy/uniapp-code-review#semver:^1.0.0"
```

> 依赖写法必须与 `package-lock.json` 保持一致；改完写法后要重跑一次 `npm install` 重新生成锁文件。

### 升级基线版本

```bash
# 1. 在包仓库打新 tag 并推送
git tag v1.1.0 && git push origin v1.1.0
# 2. 各项目拉取范围内最新版本
npm i
```

`^1.0.0` 会自动匹配 `1.x` 的新 tag；若为破坏性变更，请打 `v2.0.0`，各项目需把范围改成 `^2.0.0`。

**`@openai/codex` 需要单独安装（本包不自动安装它）**。因为 codex 的平台二进制约 400 MB，建议全团队**全局安装一次**共用：

```bash
npm i -g @openai/codex
```

也可以按项目安装：`npm i -D @openai/codex`。本包查找 codex 的顺序为：**包自身 → 项目本地 `node_modules` → npm 全局安装目录**（`npm root -g`）。

> 打包体积不受影响：本包只在 `git commit` 时被 husky 以 Node 命令调用，不会被任何页面/组件 import，因此不会进入 vite / uni-app 的构建产物。生产安装使用 `npm i --omit=dev` 时会连同本包一起跳过。

## 在项目中接入

1. 安装依赖（见上）。

2. 在项目根目录创建 `code-review.config.json`（可参考 `templates/code-review.config.example.json`）：

```json
{
  "codex": {
    "baseUrl": "http://127.0.0.1:15721/v1",
    "model": "deepseek-flash",
    "wireApi": "responses"
  },
  "stateManagement": "pinia",
  "blockStrategy": "severe-gate"
}
```

3. 在 `.husky/pre-commit` 中调用：

```sh
npx --no-install uniapp-code-review
```

（`npx --no-install` 只使用本地已安装的 bin，不会联网下载。）

4. 在 `.husky/prepare-commit-msg` 中追加留痕：

```sh
npx --no-install uniapp-code-review annotate "$1"
```

被确认放行的提交，会自动在提交信息末尾追加一行 `[review: 已确认放行 N 条严重问题 @时间]`——痕迹随 git 历史走、团队可见。这个命令**永远不会阻断提交**。

5. 在 `package.json` 里加脚本，便于手动运行与确认：

```json
{
  "scripts": {
    "review": "uniapp-code-review",
    "review:confirm": "uniapp-code-review confirm"
  }
}
```

## 配置项

| 字段 | 取值 | 说明 |
| --- | --- | --- |
| `codex.baseUrl` | 代理地址 | 本地代理地址，默认 `http://127.0.0.1:15721/v1` |
| `codex.model` | 模型名 | 默认 `deepseek-flash` |
| `codex.wireApi` | `responses` | 调用协议 |
| `stateManagement` | `pinia` / `vuex` | 决定状态管理部分注入哪一套检查项，默认 `pinia` |
| `blockStrategy` | `severe-gate` / `block-on-severe` / `never` | 阻断策略，默认 `severe-gate` |

### blockStrategy 行为

| 取值 | 无严重项 | 有严重项 | 未生成报告 | 报告格式异常 |
| --- | --- | --- | --- | --- |
| `severe-gate`（默认） | 直接放行 | 阻断，需确认后才能放行 | 阻断 | 阻断 |
| `block-on-severe` | 直接放行 | **一律阻断**（无确认通道） | 阻断 | 阻断 |
| `never` | 放行 | 放行（仅提示） | 阻断 | 放行 |

> "报告格式异常"指报告里解析不到任何 `严重 / 建议 / 可选` 章节——此时无法判定，按审查无效处理。

### 有严重项时怎么放行（`severe-gate`）

1. `git commit` 被拦下，终端会列出**全部严重项**（问题描述 + 文件位置）；
2. 打开报告逐条确认是否真的要处理；
3. 确认无异议后执行：

   ```bash
   npm run review:confirm
   ```

4. 该命令会再次打印全部严重项，并要求你**输入严重项条数**；输入不匹配即取消、不放行；
5. 确认成功后再次 `git commit` 即可提交，提交信息会自动带上留痕。

> 暂存内容一变，确认立即失效，需要重新走一遍。

配置取值非法时，提交会被阻止并打印具体错误。

## 前置准备

1. 本机已安装 Node.js 与 npm。
2. 本机已启动 deepseek 代理（地址与模型见项目配置）。

审查报告写入项目根目录的 `doc/`，建议将其加入项目的 `.gitignore`。
