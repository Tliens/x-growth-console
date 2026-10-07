// X 发送端：在自动化 Chrome 里完成回复发送（仅限通过审核看板调用的文本）
// 用法：
//   node tools/x-send.mjs --dry <帖子URL> "文本"   # 演练：填入回复框但不点发送
//   模块：import { sendReply } from './x-send.mjs'
import { pathToFileURL } from 'node:url';
import { config } from './config.mjs';
import { connect } from './bridge.mjs';

export async function sendReply(url, text, { dry = false, like = null } = {}) {
  const { browser, ctx } = await connect();
  try {
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4500);
    if (/\/login|\/i\/onboarding|\/i\/flow/.test(page.url())) throw new Error('X 未登录');

    // 拟人：先往下读一会儿再动手
    await page.mouse.wheel(0, 500 + Math.random() * 1000);
    await page.waitForTimeout(5000 + Math.random() * 13000);
    const wantLike = like === null ? Math.random() < config.likeChance : like;
    if (wantLike) {
      const likeBtn = page.locator('[data-testid="like"]').first();
      if ((await likeBtn.count()) > 0) {
        try { await likeBtn.click(); await page.waitForTimeout(1200); } catch {}
      }
    }

    // 回复输入框：帖子详情页底部
    const box = page.locator('[data-testid="tweetTextarea_0"]').first();
    if ((await box.count()) === 0) throw new Error('找不到回复输入框');
    await box.click();
    await page.keyboard.insertText(text);
    await page.waitForTimeout(600);

    const btn = page.locator('[data-testid="tweetButtonInline"], [data-testid="tweetButton"]').first();
    if ((await btn.count()) === 0) throw new Error('找不到发送按钮');
    const enabled = await btn.isEnabled();

    if (dry) {
      const filled = await box.textContent();
      await page.close();
      return { ok: true, dry: true, buttonEnabled: enabled, filledPreview: (filled || '').slice(0, 60) };
    }
    if (!enabled) { await page.close(); throw new Error('发送按钮不可用（文本为空或超限）'); }
    await btn.click();
    await page.waitForTimeout(3500); // 等待发送完成
    await page.close();
    return { ok: true, sent: true };
  } finally {
    await browser.close();
  }
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  const args = process.argv.slice(2);
  const dry = args[0] === '--dry';
  const [url, ...rest] = dry ? args.slice(1) : args;
  const text = rest.join(' ');
  if (!url || !text) { console.error('用法: node tools/x-send.mjs [--dry] <帖子URL> "文本"'); process.exit(1); }
  sendReply(url, text, { dry })
    .then((r) => { console.log(JSON.stringify(r, null, 2)); if (dry) console.log('（演练模式：未真实发送）'); })
    .catch((e) => { console.error('失败:', e.message); process.exit(1); });
}
