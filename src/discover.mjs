// 关键词发现流：搜 X 最新帖灌入机会队列，突破固定目标名单的池子限制
// 用法: node tools/discover.mjs
import { connect } from './bridge.mjs';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const OPP_FILE = 'data/opportunities.json';
import { config } from './config.mjs';
const KEYWORDS = config.discovery.keywords;

function parseCount(s) {
  if (!s) return 0;
  const m = s.replace(/,/g, '').match(/([\d.]+)\s*(万|[KM]?)/);
  if (!m) return 0;
  let v = parseFloat(m[1]);
  if (m[2] === '万') v *= 1e4; else if (m[2] === 'K') v *= 1e3; else if (m[2] === 'M') v *= 1e6;
  return Math.round(v);
}

const load = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {});
const save = (f, d) => writeFileSync(f, JSON.stringify(d, null, 2));

async function main() {
  const opps = load(OPP_FILE);
  const { browser, ctx } = await connect();
  const page = await ctx.newPage();
  let added = 0;

  for (const { kw, lang } of KEYWORDS) {
    try {
      await page.goto(`https://x.com/search?q=${encodeURIComponent(kw)}&f=live`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(4000 + Math.random() * 2000);
      if (/\/login/.test(page.url())) throw new Error('X 未登录');
      await page.mouse.wheel(0, 2500);
      await page.waitForTimeout(2000);
      const posts = await page.evaluate(() => {
        const out = [];
        for (const a of document.querySelectorAll('article[data-testid="tweet"]')) {
          const textEl = a.querySelector('[data-testid="tweetText"]');
          const timeEl = a.querySelector('time');
          const link = [...a.querySelectorAll('a[href*="/status/"]')][0];
          if (!textEl || !timeEl || !link) continue;
          const counts = {};
          for (const el of a.querySelectorAll('[data-testid="reply"],[data-testid="like"]')) {
            counts[el.dataset.testid] = el.getAttribute('aria-label') || '';
          }
          const path = new URL(link.href, 'https://x.com').pathname;
          out.push({
            url: `https://x.com${path}`,
            handle: path.split('/')[1],
            text: textEl.innerText.slice(0, 240),
            postedAt: timeEl.getAttribute('datetime'),
            repliesRaw: counts.reply || '', likesRaw: counts.like || '',
          });
        }
        return out;
      });
      let kwAdded = 0;
      for (const p of posts) {
        p.repliesN = parseCount(p.repliesRaw);
        p.likesN = parseCount(p.likesRaw);
        const ageH = (Date.now() - new Date(p.postedAt).getTime()) / 3600000;
        if (ageH > 36 || p.likesN + p.repliesN < 2 || /^@/.test(p.text.trim())) continue;
        if (opps[p.url]) continue;
        const velocity = (p.likesN + 3 * p.repliesN) / Math.max(ageH, 0.5);
        opps[p.url] = {
          handle: p.handle, lang, note: `关键词「${kw}」发现`, foundVia: `discover:${kw}`,
          text: p.text, postedAt: p.postedAt, repliesN: p.repliesN, likesN: p.likesN,
          ageH: Math.round(ageH * 10) / 10,
          score: Math.round(velocity * (ageH < 2 ? 2 : ageH < 6 ? 1.5 : 1)),
          url: p.url, foundAt: new Date().toISOString(),
        };
        kwAdded++;
      }
      added += kwAdded;
      console.log(`「${kw}」扫到 ${posts.length} 帖，入库 ${kwAdded}`);
    } catch (e) {
      console.log(`「${kw}」失败: ${String(e).slice(0, 70)}`);
    }
    await page.waitForTimeout(5000 + Math.random() * 5000);
  }
  await page.close();
  await browser.close();
  save(OPP_FILE, opps);
  const zh = Object.values(opps).filter((p) => p.lang === 'zh').length;
  console.log(`\n发现流完成：新增 ${added} 条，队列总计 ${Object.keys(opps).length} 条（中文 ${zh}）`);
}

main().catch((e) => { console.error('失败:', e.message); process.exit(1); });
