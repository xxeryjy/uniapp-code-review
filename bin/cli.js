#!/usr/bin/env node
// CLI 入口：供各项目的 husky 调用
//   uniapp-code-review                 跑审查（pre-commit）
//   uniapp-code-review confirm         确认放行（有严重项被拦下后使用）
//   uniapp-code-review annotate <file> 往提交信息追加审查留痕（prepare-commit-msg）
const { main, runConfirm, runAnnotate } = require('../lib/review');

const [command, arg] = process.argv.slice(2);

// 留痕命令永不阻断提交
if (command === 'annotate') {
  try {
    runAnnotate(arg);
  } catch (error) {
    console.error(`追加审查留痕失败：${error.message}`);
  }
  process.exitCode = 0;
} else {
  const task = command === 'confirm' ? runConfirm() : main();

  task
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(`审查入口执行失败：${error.message}`);
      process.exitCode = 1;
    });
}
