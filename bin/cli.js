#!/usr/bin/env node
// CLI 入口：供各项目的 husky pre-commit 调用（node node_modules/@wenshanhu/uniapp-code-review/bin/cli.js）
const { main } = require('../lib/review');

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(`审查入口执行失败：${error.message}`);
    process.exitCode = 1;
  });
