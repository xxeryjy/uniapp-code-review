/* eslint-disable @typescript-eslint/no-var-requires */
// uniapp 代码审查组装器（跨项目共用版本）
// 读取项目根目录的 code-review.config.json，把包内基线规则（baseline/）与项目差异化配置组装成
// 最终 prompt 交给 Codex 审查暂存改动，并按 blockStrategy 决定是否阻断提交。
const { spawn, execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// 被审查的项目根目录：由 husky 触发时即仓库根目录
const PROJECT_ROOT = process.cwd();
const DOC_DIR = path.join(PROJECT_ROOT, 'doc');
const STATE_PATH = path.join(DOC_DIR, '.review-state');
const CONFIG_PATH = path.join(PROJECT_ROOT, 'code-review.config.json');
const MAX_CAPTURED_STDERR_CHARS = 128 * 1024;

// 包内基线规则
const BASELINE_DIR = path.join(__dirname, '..', 'baseline');

// 默认配置：项目未提供 code-review.config.json 时兜底
const DEFAULT_CONFIG = {
  codex: {
    baseUrl: 'http://127.0.0.1:15721/v1',
    model: 'deepseek-flash',
    wireApi: 'responses',
  },
  stateManagement: 'pinia',
  blockStrategy: 'advise-first',
};

// 状态管理框架的差异化检查项，由 config.stateManagement 决定注入哪一套
const STATE_MANAGEMENT_CHECKS = {
  pinia: [
    '`option store` 与 `setup store` 风格在项目内是否一致',
    '`storeToRefs` 使用是否正确（避免解构后丢失响应式）',
    '是否存在绕过 store action 直接改写 state 的情况',
  ],
  vuex: [
    'mutations 是否保持同步，异步逻辑是否放在 actions',
    'getters 是否用于派生状态',
    '是否存在绕过 mutation 直接改写 state 的情况',
  ],
};

// 阻断策略：advise-first（报告生成后阻断一次，内容不变再提交放行）
//          block-on-severe（报告含严重项才阻断）
//          never（只提示不阻断内容）
const BLOCK_STRATEGIES = ['advise-first', 'block-on-severe', 'never'];

const pad = (n) => String(n).padStart(2, '0');

function timestamp() {
  const d = new Date();
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

// 定位 @openai/codex 的入口：兼容 npm 提升安装与 pnpm 嵌套安装
function resolveCodexEntry() {
  try {
    return require.resolve('@openai/codex/bin/codex.js', { paths: [__dirname, PROJECT_ROOT] });
  } catch (error) {
    throw new Error('未找到 @openai/codex，请先在本项目执行 npm install。');
  }
}

// 读取并校验项目配置
function loadConfig() {
  let raw = {};
  if (fs.existsSync(CONFIG_PATH)) {
    raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } else {
    console.warn('未找到 code-review.config.json，使用默认配置。');
  }

  const config = {
    codex: { ...DEFAULT_CONFIG.codex, ...(raw.codex || {}) },
    stateManagement: raw.stateManagement || DEFAULT_CONFIG.stateManagement,
    blockStrategy: raw.blockStrategy || DEFAULT_CONFIG.blockStrategy,
  };

  if (!STATE_MANAGEMENT_CHECKS[config.stateManagement]) {
    throw new Error(
      `stateManagement 取值非法：${config.stateManagement}（应为 ${Object.keys(STATE_MANAGEMENT_CHECKS).join(' / ')}）`,
    );
  }
  if (!BLOCK_STRATEGIES.includes(config.blockStrategy)) {
    throw new Error(
      `blockStrategy 取值非法：${config.blockStrategy}（应为 ${BLOCK_STRATEGIES.join(' / ')}）`,
    );
  }

  return config;
}

// 读取包内基线文件
function readBaseline(fileName) {
  const filePath = path.join(BASELINE_DIR, fileName);
  return fs.readFileSync(filePath, 'utf8');
}

// 组装最终审查指令：基线规则 + 报告格式契约 + 项目差异化配置
function buildPrompt(config) {
  const skill = readBaseline('SKILL.md');
  const contract = readBaseline('output-contract.md');
  const extraChecks = STATE_MANAGEMENT_CHECKS[config.stateManagement];

  return [
    '你是 uniapp 跨端项目的代码审查专家，请严格按下面的基线规则与项目配置执行审查。',
    '',
    '# 基线规则',
    '',
    skill.trim(),
    '',
    '# 报告输出格式契约（硬契约，必须严格遵守）',
    '',
    contract.trim(),
    '',
    '# 本项目配置',
    '',
    `- 状态管理框架：${config.stateManagement}`,
    '- 除基线通用项外，状态管理需额外检查：',
    ...extraChecks.map((item) => `  - ${item}`),
    '',
    '请审查 git diff --cached 的暂存改动，按上述格式契约输出中文报告，不要修改任何文件。',
  ].join('\n');
}

// 仅接受完整的“无严重问题”声明，避免无问题描述后追加真实风险时被误判为无问题。
const NO_ISSUE_PATTERNS = [
  /^无[。.!！]?$/,
  /^(?:(?:本次|本轮|此次)?审查)?(?:暂时|暂)?(?:无|没有发现|未发现|暂无(?:发现)?|不存在|没有)(?:任何)?(?:严重(?:级别)?|高危|高风险)?(?:问题|风险|隐患|缺陷)[。.!！]?$/,
  /^(?:无需|不需要)(?:任何)?修改[。.!！]?$/,
  /^无(?:任何)?修改建议[。.!！]?$/,
];

const NO_ISSUE_FIELD_VALUE_RE = /^(?:无|暂无|不适用|n\/a|na|none|null)[。.!！]?$/i;
const NO_ISSUE_PREFIX_RE =
  /^(?:(?:本次|本轮|此次)?审查)?(?:暂时|暂)?(?:无|没有发现|未发现|暂无(?:发现)?|不存在|没有)(?:任何)?(?:严重(?:级别)?|高危|高风险)?(?:问题|风险|隐患|缺陷)/;
const NO_ISSUE_FOLLOWUP_RE =
  /^[，。；;、\s]*(?:已(?:经)?确认|经确认|确认)[^，。；;]*(?:无|没有发现|未发现|暂无|不存在)(?:任何)?(?:严重(?:级别)?|高危|高风险)?(?:问题|风险|隐患|缺陷)[。.!！]?$/;

// 报告章节标题：用于划分 严重 / 建议 / 可选 三个区段
const SECTION_HEADING_RE = /^(#{1,6})\s*(.*)$/;
// 报告条目字段行，如 “- **问题描述** — xxx”“**文件位置**：xxx”
const FIELD_LINE_RE = /^(?:[-*+]\s*)?\*\*(问题描述|问题|文件位置|修改建议)[:：]?\*\*\s*(.*)$/;

function isNoIssueText(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  if (NO_ISSUE_FIELD_VALUE_RE.test(value)) return true;
  if (NO_ISSUE_PATTERNS.some((re) => re.test(value))) return true;

  const prefixMatch = value.match(NO_ISSUE_PREFIX_RE);
  if (!prefixMatch) return false;

  const remainder = value.slice(prefixMatch[0].length).trim();
  if (/^[，。；;、！!？?\s]*$/.test(remainder)) return true;
  return NO_ISSUE_FOLLOWUP_RE.test(remainder);
}

function normalizeFieldValue(value) {
  return String(value || '')
    .replace(/^\s*[:：—–-]+\s*/, '')
    .trim();
}

// 解析审查报告：统计三级条目数并提取严重项明细
function summarizeReport(content) {
  const lines = String(content || '')
    .replace(/\r\n?/g, '\n')
    .split('\n');

  const summary = { severe: [], suggestionCount: 0, optionalCount: 0 };
  let section = null;
  let item = null;

  const flushItem = () => {
    if (!item) return;
    if (section === 'severe') {
      if (item.desc && !isNoIssueText(item.desc)) {
        summary.severe.push(item);
      }
    } else if (section === 'suggestion') {
      summary.suggestionCount += 1;
    } else if (section === 'optional') {
      summary.optionalCount += 1;
    }
    item = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const headingMatch = line.match(SECTION_HEADING_RE);
    if (headingMatch) {
      flushItem();
      const title = headingMatch[2].trim();
      if (/^严重(?!性|程度)/.test(title)) {
        section = 'severe';
      } else if (/^建议(?!性|程度)/.test(title)) {
        section = 'suggestion';
      } else if (/^可选/.test(title)) {
        section = 'optional';
      } else {
        section = null;
      }
      continue;
    }

    if (!section) continue;

    const fieldMatch = line.match(FIELD_LINE_RE);
    if (!fieldMatch) continue;

    const fieldName = fieldMatch[1] === '问题' ? '问题描述' : fieldMatch[1];
    const value = normalizeFieldValue(fieldMatch[2]);

    if (fieldName === '问题描述') {
      flushItem();
      item = { desc: value, location: '' };
    } else if (fieldName === '文件位置' && item) {
      item.location = value;
    }
  }

  flushItem();

  return summary;
}

// 计算暂存区 diff 的指纹，作为“同一改动”的判定依据
function computeStagedFingerprint() {
  const diff = execFileSync('git', ['diff', '--cached', '--no-color'], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return crypto.createHash('sha256').update(String(diff), 'utf8').digest('hex');
}

function readReviewState() {
  try {
    if (!fs.existsSync(STATE_PATH)) return null;
    const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    if (state && typeof state.fingerprint === 'string' && typeof state.report === 'string') {
      return state;
    }
    return null;
  } catch (error) {
    return null;
  }
}

function writeReviewState(fingerprint, reportRel) {
  const state = { fingerprint, report: reportRel, time: new Date().toISOString() };
  fs.writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

// 在终端打印报告位置与三级条目明细，返回解析结果供后续判定复用
function printReportSummary(reportRel) {
  console.log(`审查报告：${reportRel}`);

  const reportAbs = path.join(PROJECT_ROOT, reportRel);
  if (!fs.existsSync(reportAbs)) {
    console.log('  （报告文件不存在，无法统计条目）');
    return null;
  }

  let summary;
  try {
    summary = summarizeReport(fs.readFileSync(reportAbs, 'utf8'));
  } catch (error) {
    console.error(`  （读取报告失败：${error.message}）`);
    return null;
  }

  console.log(`  - 严重：${summary.severe.length} 条`);
  console.log(`  - 建议：${summary.suggestionCount} 条`);
  console.log(`  - 可选：${summary.optionalCount} 条`);

  if (summary.severe.length > 0) {
    console.log('  严重项明细（仅提示）：');
    for (const entry of summary.severe) {
      const location = entry.location ? `（${entry.location}）` : '';
      console.log(`    · ${entry.desc}${location}`);
    }
  }

  return summary;
}

function redactSensitiveText(text) {
  return String(text || '')
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+/gi, '$1***')
    .replace(
      /((?:api[_-]?key|access[_-]?token|auth[_-]?token|authorization)\s*[:=]\s*)[^\s,;]+/gi,
      '$1***',
    )
    .replace(/(https?:\/\/)([^/\s:@]+):([^@\s/]+)@/gi, '$1***:***@');
}

function createFencedCodeBlock(text) {
  const matchedRuns = String(text || '').match(/`+/g) || [];
  const longestRun = matchedRuns.reduce((max, run) => Math.max(max, run.length), 0);
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  return `${fence}text\n${text}\n${fence}`;
}

function runCodex(args, output) {
  const stdout = (output && output.stdout) || process.stdout;
  const stderrOutput = (output && output.stderr) || process.stderr;

  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: PROJECT_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    let stderr = '';
    let stderrTruncated = false;
    let spawnError = null;
    let settled = false;

    const finish = (status, signal) => {
      if (settled) return;
      settled = true;

      if (stderrTruncated) {
        stderr += '\n...[标准错误已截断]...';
      }

      resolve({ status, signal, error: spawnError, stderr });
    };

    child.stdout.on('data', (chunk) => {
      stdout.write(chunk);
    });

    child.stderr.on('data', (chunk) => {
      stderrOutput.write(chunk);
      if (stderrTruncated) return;

      const remaining = MAX_CAPTURED_STDERR_CHARS - stderr.length;
      if (remaining <= 0) {
        stderrTruncated = true;
        return;
      }

      stderr += chunk.slice(0, remaining);
      if (chunk.length > remaining) stderrTruncated = true;
    });

    child.once('error', (error) => {
      spawnError = error;
      finish(null, null);
    });

    child.once('close', (status, signal) => {
      finish(status, signal);
    });
  });
}

function getFailureReason(result) {
  if (result.error) return `Codex 启动失败：${result.error.message}`;
  if (result.signal) return `Codex 被信号 ${result.signal} 中断`;
  if (result.status !== 0) return `Codex 执行失败（退出码 ${result.status}）`;
  return 'Codex 执行完成但未生成审查报告';
}

function writeFailureReport(reportPath, reason, result) {
  const status = result && Number.isInteger(result.status) ? result.status : '未知';
  const signal = result && result.signal ? result.signal : '无';
  const errorMessage = result && result.error ? redactSensitiveText(result.error.message) : '';
  const stderr = result && result.stderr ? redactSensitiveText(result.stderr.trim()) : '';

  const content = [
    '# uniapp 代码审查未完成',
    '',
    `- 时间：${new Date().toISOString()}`,
    `- 原因：${redactSensitiveText(reason)}`,
    `- 退出码：${status}`,
    `- 信号：${signal}`,
    errorMessage ? `- 执行错误：${errorMessage}` : null,
    stderr ? `\n## Codex 错误输出\n\n${createFencedCodeBlock(stderr)}` : null,
    '',
    '本次审查未完成，无法确认暂存改动是否存在严重问题，提交已阻止。请检查 Codex 运行环境、模型配置及本地路由服务。',
  ]
    .filter((part) => part !== null && part !== undefined)
    .join('\n');

  fs.writeFileSync(reportPath, `${content}\n`, 'utf8');
}

async function main() {
  if (!fs.existsSync(DOC_DIR)) {
    fs.mkdirSync(DOC_DIR, { recursive: true });
  }

  let config;
  try {
    config = loadConfig();
  } catch (error) {
    console.error(`审查配置错误：${error.message}`);
    return 1;
  }

  let codexEntry;
  try {
    codexEntry = resolveCodexEntry();
  } catch (error) {
    console.error(error.message);
    return 1;
  }

  const fingerprint = computeStagedFingerprint();
  const state = readReviewState();

  // advise-first：暂存内容与上次审查时完全一致，说明已看过报告，直接放行
  if (config.blockStrategy === 'advise-first' && state && state.fingerprint === fingerprint) {
    console.log('本次暂存内容已审查过，直接放行。');
    printReportSummary(state.report);
    return 0;
  }

  const reportName = `uniapp-code-review-${timestamp()}.md`;
  const reportRel = path.join('doc', reportName);

  const args = [
    codexEntry,
    'exec',
    '-C',
    '.',
    '-s',
    'read-only',
    '-c',
    'model_provider="custom"',
    '-c',
    `model="${config.codex.model}"`,
    '-c',
    'model_providers.custom.name="deepseek"',
    '-c',
    `model_providers.custom.base_url="${config.codex.baseUrl}"`,
    '-c',
    `model_providers.custom.wire_api="${config.codex.wireApi}"`,
    '-c',
    'model_providers.custom.requires_openai_auth=true',
    '-c',
    'model_providers.custom.experimental_bearer_token="PROXY_MANAGED"',
    '-o',
    reportRel,
    buildPrompt(config),
  ];

  const result = await runCodex(args);
  const reportAbs = path.join(PROJECT_ROOT, reportRel);

  // 审查没有产出报告：无论哪种策略都阻断，避免误放行
  if (result.status !== 0 || !fs.existsSync(reportAbs)) {
    if (!fs.existsSync(reportAbs)) {
      try {
        writeFailureReport(reportAbs, getFailureReason(result), result);
      } catch (error) {
        console.error(`写入失败报告失败：${error.message}`);
      }
    } else {
      console.error('Codex 非零退出，但已生成报告，保留原报告内容。');
    }

    console.log(`Codex 审查未完成，提交已阻止。报告：${reportRel}`);
    return 1;
  }

  // advise-first：记住本次指纹，供“内容不变的再次提交”放行
  if (config.blockStrategy === 'advise-first') {
    writeReviewState(fingerprint, reportRel);
  }

  const summary = printReportSummary(reportRel);

  if (config.blockStrategy === 'never') {
    console.log('审查完成，当前策略不阻断提交。');
    return 0;
  }

  if (config.blockStrategy === 'block-on-severe') {
    if (summary && summary.severe.length > 0) {
      console.log('审查发现严重问题，提交已阻止。');
      return 1;
    }
    console.log('审查完成，未发现严重问题，提交通过。');
    return 0;
  }

  // advise-first：报告生成后阻断一次，提示先看报告
  console.log('审查报告已生成，请先查看报告内容，再自行判断是否提交本次改动。');
  console.log('确认无需修改后，再次执行 git commit（不要改动暂存内容）即可通过。');
  return 1;
}

module.exports = {
  main,
  timestamp,
  loadConfig,
  buildPrompt,
  summarizeReport,
  computeStagedFingerprint,
  readReviewState,
  writeReviewState,
  redactSensitiveText,
  createFencedCodeBlock,
  runCodex,
  writeFailureReport,
};
