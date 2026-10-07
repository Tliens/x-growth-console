// 引用/转推：补全真人时间线动作
// 用法：
//   node tools/amplify.mjs --quote-draft <url>      # 起草引用语（待审）
//   node tools/amplify.mjs --quote-send <url> [文本] # 发送引用（文本缺省取待审草稿）
//   node tools/amplify.mjs --rt <url>               # 直接转推
import { connect } from './bridge.mjs';
import { askLLM } from './llm.mjs';
import { buildQuotePrompt, START_MARKER, END_MARKER } from './persona.mjs';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const OPP_FILE = 'data/opportunities.json';
const QUOTE_FILE = 'data/quotes.json';
const ENGAGE_FILE = 'data/engagement.json';
const today = () => new Date().toISOString().slice(0, 10);
const load = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {});
const save = (f, d) => writeFileSync(f, JSON.stringify(d, null, 2));
const track = (key, val) => { const s = load(ENGAGE_FILE); if (!s[today()]) s[today()] = { likes: [], follows: [] }; (s[today()][key] = s[today()][key] || []).push(val); save(ENGAGE_FILE, s); };

async function openPost(ctx, url) {
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000 + Math.random() * 4000);
  if (/\/login|\/i\/onboarding|\/i\/flow/.test(page.url())) { await page.close(); throw new Error('X 未登录'); }
  return page;
}

async function retweet(ctx, url) {
  const page = await openPost(ctx, url);
  try {
    const rtBtn = page.locator('[data-testid="retweet"]').first();
    if ((await rtBtn.count()) === 0) { console.log('已转推过或找不到按钮，跳过'); return; }
    await rtBtn.click();
    await page.waitForTimeout(900);
    // 菜单里点「转推」，若弹出确认再点确认
    const item = page.getByRole('menuitem', { name: /转推|Repost/i }).first();
    if ((await item.count()) > 0) {
      await item.click();
      await page.waitForTimeout(800);
      const confirm = page.locator('[data-testid="confirmationSheetConfirm"]').first();
      if ((await confirm.count()) > 0) await confirm.click();
    }
    await page.waitForTimeout(1500);
    track('rts', url);
    console.log(`🔁 已转推: ${url}`);
  } finally { await page.close(); }
}

async function quoteSend(ctx, url, text) {
  const page = await openPost(ctx, url);
  try {
    const rtBtn = page.locator('[data-testid="retweet"]').first();
    if ((await rtBtn.count()) === 0) throw new Error('找不到转推按钮');
    await rtBtn.click();
    await page.waitForTimeout(900);
    const quoteItem = page.getByRole('menuitem', { name: /引用|Quote/i }).first();
    if ((await quoteItem.count()) === 0) throw new Error('菜单里没有「引用」项');
    await quoteItem.click();
    await page.waitForTimeout(1500);
    const box = page.locator('[data-testid="tweetTextarea_0"]').first();
    if ((await box.count()) === 0) throw new Error('引用编辑器没打开');
    await box.click();
    await page.keyboard.insertText(text);
    await page.waitForTimeout(700);
    const send = page.locator('[data-testid="tweetButton"]').first();
    if (!(await send.isEnabled())) throw new Error('发送按钮不可用');
    await send.click();
    await page.waitForTimeout(2500);
    track('quotes', url);
    console.log(`💬 引用已发送: ${url}\n    ${text.replace(/\n/g, ' ')}`);
  } finally { await page.close(); }
}

async function main() {
  const [cmd, url, ...rest] = process.argv.slice(2);
  if (!cmd || !url) {
    console.log('用法: node tools/amplify.mjs --quote-draft <url> | --quote-send <url> [文本] | --rt <url>');
    return;
  }
  if (cmd === '--rt') {
    const { browser, ctx } = await connect();
    await retweet(ctx, url);
    await browser.close();
    return;
  }
  if (cmd === '--quote-draft') {
    const opps = load(OPP_FILE);
    const post = opps[url];
    if (!post) throw new Error('机会队列里没有这条帖子');
    const { browser, ctx } = await connect();
    let draft;
    try { draft = await askLLM(ctx, buildQuotePrompt(post), START_MARKER, END_MARKER); }
    finally { await browser.close(); }
    draft = draft.replace(/^["“」]|\s*["”」]$/g, '').trim();
    if (!draft) throw new Error('空草稿');
    const quotes = load(QUOTE_FILE);
    quotes[url] = { ...post, url, draft, status: 'pending', createdAt: new Date().toISOString() };
    save(QUOTE_FILE, quotes);
    console.log(`引用草稿（待审，未发送）:\n  原帖: @${post.handle} ${post.text.replace(/\n/g, ' ').slice(0, 60)}\n  草稿: ${draft}`);
    return;
  }
  if (cmd === '--quote-send') {
    const quotes = load(QUOTE_FILE);
    const text = rest.join(' ') || quotes[url]?.draft;
    if (!text) throw new Error('没有可发送的引用文本');
    const { browser, ctx } = await connect();
    await quoteSend(ctx, url, text);
    await browser.close();
    if (quotes[url]) { quotes[url].status = 'sent'; quotes[url].sentText = text; save(QUOTE_FILE, quotes); }
    return;
  }
  console.log('未知命令');
}
main().catch((e) => { console.error('失败:', e.message); process.exit(1); });
