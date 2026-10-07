// Grok 情报源：通过自动化 Chrome 与 x.com/i/grok 对话
// 用法：
//   node tools/grok.mjs probe              # 探测输入框结构
//   node tools/grok.mjs ask "问题"         # 提问并等待回答
// 也可作为模块：import { askGrok } from './grok.mjs'
import { pathToFileURL } from 'node:url';
import { connect } from './bridge.mjs';

const GROK_URL = 'https://x.com/i/grok';

// 回答之前就存在的 UI 噪音（跳过即可）
const PRE_NOISE = [
  /^To view keyboard shortcuts/i, /^View keyboard shortcuts/i, /^\d+$/,
  /^History$/, /^Share$/, /^New chat$/, /^Thought for .*$/,
];
// 回答结束后出现的 UI 噪音（遇到即停）
const POST_NOISE = [
  /^\d+\s*sources$/i, /^\d+\s*个来源$/, /^Shared links/i, /^Try again$/i,
  /^Think Harder$/i, /^Ask anything$/i, /^Auto$/,
];

// raw: 页面全文；marker: 提问末尾的标记行（在此之后开始取）；endMarker: 让 Grok 输出的结束标记
export function cleanAnswer(raw, marker = null, endMarker = null) {
  let lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  if (marker) {
    const idx = lines.map((l) => l.includes(marker)).lastIndexOf(true);
    if (idx >= 0) lines = lines.slice(idx + 1);
  } else {
    while (lines.length && PRE_NOISE.some((re) => re.test(lines[0]))) lines.shift();
  }
  const out = [];
  for (const l of lines) {
    if (endMarker && l.includes(endMarker)) {
      const head = l.split(endMarker)[0].trim();
      if (head) out.push(head); // 结束标记与答案同行时，保留标记前的内容
      break;
    }
    if (POST_NOISE.some((re) => re.test(l))) break;
    if (PRE_NOISE.some((re) => re.test(l))) continue;
    out.push(l);
  }
  return out.join('\n');
}

async function getGrokPage(ctx) {
  let page = ctx.pages().find((p) => p.url().split('?')[0].includes('/i/grok'));
  if (!page) {
    page = await ctx.newPage();
    await page.goto(GROK_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  }
  await page.waitForTimeout(4000);
  if (/\/login|\/i\/onboarding|\/i\/flow/.test(page.url())) {
    throw new Error('X 未登录，Grok 不可用');
  }
  return page;
}

// 提问并等待回答完成。给了 endMarker 时轮询等待该标记出现（精确完成信号），否则退化为文本稳定性判断
export async function askGrok(ctx, question, marker = null, endMarker = null) {
  const page = await ctx.newPage();
  await page.goto(GROK_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }); // 每次开新会话，避免上下文污染
  await page.waitForTimeout(4000);
  if (/\/login|\/i\/onboarding|\/i\/flow/.test(page.url())) {
    await page.close();
    throw new Error('X 未登录，Grok 不可用');
  }
  await page.getByText('New chat', { exact: true }).first().click().catch(() => {});
  await page.waitForTimeout(1200);
  const editable = page.locator('[contenteditable="true"][role="textbox"]').first();
  await editable.click();
  await page.keyboard.insertText(question);
  await page.waitForTimeout(700);
  await page.keyboard.press('Enter');

  const deadline = Date.now() + 300000;
  let raw = '';
  if (endMarker) {
    while (Date.now() < deadline) {
      await page.waitForTimeout(3000);
      raw = await page.evaluate(() => document.body.innerText);
      // 提示词回显本身含一次 endMarker，须等到第 2 次出现（Grok 真正输出）才算完成
      if (raw.split(endMarker).length - 1 >= 2) break;
    }
  } else {
    let stable = 0, last = -1;
    while (stable < 6 && Date.now() < deadline) {
      await page.waitForTimeout(1000);
      const now = await page.evaluate(() => document.body.innerText.length);
      if (now === last) stable += 1; else { stable = 0; last = now; }
    }
    raw = await page.evaluate(() => document.body.innerText);
  }
  await page.close();
  return cleanAnswer(raw, marker, endMarker);
}

async function main() {
  const cmd = process.argv[2] ?? 'probe';
  const { browser, ctx } = await connect();
  if (cmd === 'probe') {
    const page = await getGrokPage(ctx);
    const info = await page.evaluate(() => ({
      url: location.href,
      editables: [...document.querySelectorAll('[contenteditable="true"]')].map((e) => ({
        role: e.getAttribute('role'), ph: e.getAttribute('data-placeholder') || e.getAttribute('aria-label'),
      })),
    }));
    console.log(JSON.stringify(info, null, 2));
  } else if (cmd === 'ask') {
    const question = process.argv[3];
    if (!question) throw new Error('用法: node tools/grok.mjs ask "问题"');
    console.log('已发送，等待 Grok 回答...');
    const answer = await askGrok(ctx, question);
    console.log('=== Grok 回答 ===');
    console.log(answer);
  }
  await browser.close();
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) main().catch((e) => { console.error('失败:', e.message); process.exit(1); });
