// 腾讯元宝适配：作为起草 LLM（Grok 被限流后的替代）
// 用法：
//   node tools/yuanbao.mjs probe            # 探测输入框
//   node tools/yuanbao.mjs ask "问题"        # 提问并取回答
// 模块：import { askYuanbao } from './yuanbao.mjs'
import { pathToFileURL } from 'node:url';
import { connect } from './bridge.mjs';

const YB_URL = 'https://yuanbao.tencent.com/chat';

const PRE_NOISE = [
  /^元宝$/, /^Hi, 今天从哪里开始$/, /^搜索$/, /^全部分享$/, /^全部收藏$/, /^历史$/, /^分组$/, /^聊天$/, /^\d+$/,
  /^收起$/, /^展开$/, /^已(核实|搜索|联网|深度)/, /^正在(思考|搜索|核实)/,
];
const POST_NOISE = [
  /^内容由AI生成/, /^深度思考/, /^已深度思考/, /^联网搜索/, /^停止响应$/, /^重新生成$/,
  /^复制$/, /^分享$/, /^点赞|^点踩/, /^更多$/, /^工具$/, /^安装元宝/, /^安装电脑版$/, /^我知道了$/, /^下载元宝/,
  /^专家模式$/, /^技能$/, /^深度研究$/, /^专业写作$/, /^PPT ?生成$/, /^AI ?生图$/, /^数据分析$/,
  /^金融理财$/, /^个人计划$/, /^旅游计划$/, /^饮食助手$/, /^随时随地/, /^立即下载/,
];

function clean(raw, marker, endMarker) {
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
      if (head) out.push(head);
      break;
    }
    if (POST_NOISE.some((re) => re.test(l))) break;
    if (PRE_NOISE.some((re) => re.test(l))) continue;
    out.push(l);
  }
  return out.join('\n');
}

export async function askYuanbao(ctx, question, marker = null, endMarker = null) {
  const page = await ctx.newPage();
  await page.goto(YB_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(7000);
  const url = page.url();
  if (/login|signin/i.test(url)) { await page.close(); throw new Error('元宝未登录'); }

  // 尽力关掉推广弹窗 + 开新对话（旧会话残留的 [[END]] 会污染完成判断）
  await page.getByText('我知道了', { exact: true }).first().click({ timeout: 2500 }).catch(() => {});
  await page.getByText('新建对话', { exact: true }).first().click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(1500);

  const editor = page.locator(
    '[contenteditable="true"], [contenteditable="plaintext-only"], [role="textbox"], textarea',
  ).first();
  if ((await editor.count()) === 0) { await page.close(); throw new Error('找不到元宝输入框'); }
  await editor.click();
  await page.keyboard.insertText(question);
  await page.waitForTimeout(800);
  await page.keyboard.press('Enter');

  const deadline = Date.now() + 300000;
  let raw = '';
  if (endMarker) {
    while (Date.now() < deadline) {
      await page.waitForTimeout(3000);
      raw = await page.evaluate(() => document.body.innerText);
      // 提示词回显本身含一次 endMarker，须等到第 2 次出现才算答完
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
  return clean(raw, marker, endMarker);
}

async function main() {
  const cmd = process.argv[2] ?? 'probe';
  const { browser, ctx } = await connect();
  if (cmd === 'probe') {
    const page = await ctx.newPage();
    await page.goto(YB_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(7000);
    const info = await page.evaluate(() => ({
      editables: [...document.querySelectorAll('[contenteditable]')].map((e) => ({
        val: e.getAttribute('contenteditable'), role: e.getAttribute('role'),
        ph: e.getAttribute('data-placeholder') || e.getAttribute('aria-label'),
      })),
    }));
    console.log('URL:', page.url());
    console.log(JSON.stringify(info, null, 1));
  } else if (cmd === 'ask') {
    const q = process.argv[3];
    if (!q) throw new Error('用法: node tools/yuanbao.mjs ask "问题"');
    console.log('已发送，等待元宝回答...');
    console.log(await askYuanbao(ctx, q));
  }
  await browser.close();
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) main().catch((e) => { console.error('失败:', e.message); process.exit(1); });
