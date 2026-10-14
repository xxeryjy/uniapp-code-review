# @wenshanhu/uniapp-code-review

uniapp 跨端项目的 AI 代码审查基线。配合 `git commit` 门禁使用：

- **基线规则跨项目共用**（本包内置 `baseline/`）；
- **项目差异通过配置声明**（各项目的 `code-review.config.json`）；
- 审查结论**只作建议**，是否阻断由项目的 `blockStrategy` 决定。

## 安装

以 git 依赖方式安装为 devDependency：

```bash
npm i -D git+https://github.com/xxeryjy/uniapp-code-review.git
```

> 打包体积不受影响：本包只在 `git commit` 时被 husky 以 Node 命令调用，不会被任何页面/组件 import，因此不会进入 vite / uni-app 的构建产物。生产安装使用 `npm i --omit=dev` 时会连同本包及其依赖一起跳过。

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
  "blockStrategy": "advise-first"
}
```

3. 在 `.husky/pre-commit` 中调用：

```sh
node node_modules/@wenshanhu/uniapp-code-review/bin/cli.js
```

4. 可选：在 `package.json` 里加脚本，便于手动运行。

```json
{
  "scripts": {
    "review": "uniapp-code-review"
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
| `blockStrategy` | `advise-first` / `block-on-severe` / `never` | 阻断策略，默认 `advise-first` |

### blockStrategy 行为

| 取值 | 有报告 | 无报告（代理异常） |
| --- | --- | --- |
| `advise-first` | 阻断一次，看过后原样再提交即放行 | 阻断 |
| `block-on-severe` | 报告含“严重”条目才阻断 | 阻断 |
| `never` | 只提示不阻断 | 阻断 |

配置取值非法时，提交会被阻止并打印具体错误。

## 前置准备

1. 本机已安装 Node.js 与 npm。
2. 本机已启动 deepseek 代理（地址与模型见项目配置）。

审查报告写入项目根目录的 `doc/`，建议将其加入项目的 `.gitignore`。
