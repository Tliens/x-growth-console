// 回复雷达：扫描目标账号的最新帖子，按互动速度打分，产出机会队列
// 用法：
//   node tools/radar.mjs scan     # 扫描 config/targets.json 里所有目标
//   node tools/radar.mjs report   # 打印当前机会队列 TOP
import { connect } from './bridge.mjs';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

const DATA_FILE = 'data/opportunities.json';

function parseCount(s) {
  if (!s) return 0;
  const m = s.replace(/,/g, '').match(/([\d.]+)\s*(万|K|M|k|m)?/);
  if (!m) return 0;
  let v = parseFloat(m[1]);
  const u = (m[2] || '').toLowerCase();
  if (u === '万') v *= 10000;
  else if (u === 'k') v *= 1000;
  else if (u === 'm') v *= 1000000;
  return Math.round(v);
}

async function scanProfile(page, handle) {
  await page.goto(`https://x.com/${handle}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3500);
  if (/\/login|\/i\/onboarding|\/i\/flow/.test(page.url())) throw new Error('X 未登录');
  // 轻微滚动，触发懒加载
  await page.mouse.wheel(0, 1200);
  await page.waitForTimeout(1500);
  return page.evaluate((me) => {
    const posts = [];
    for (const a of document.querySelectorAll('article[data-testid="tweet"]')) {
      const ctx = a.querySelector('[data-testid="socialContext"]');
      const ctxText = ctx ? ctx.innerText : '';
      if (/置顶|Pinned|转推了|Retweeted|转发了/i.test(ctxText)) continue;
      const timeEl = a.querySelector('time');
      const textEl = a.querySelector('[data-testid="tweetText"]');
      const linkEl = [...a.querySelectorAll(`a[href^="/${me}/status/"]`)][0];
      if (!timeEl || !textEl || !linkEl) continue;
      const counts = {};
      for (const el of a.querySelectorAll('[data-testid="reply"],[data-testid="retweet"],[data-testid="like"]')) {
        counts[el.dataset.testid] = el.getAttribute('aria-label') || '';
      }
      posts.push({
        url: `https://x.com${new URL(linkEl.href, 'https://x.com').pathname}`,
        text: textEl.innerText.slice(0, 240),
        postedAt: timeEl.getAttribute('datetime'),
        replies: counts.reply || '', retweets: counts.retweet || '', likes: counts.like || '',
      });
    }
    return posts;
  }, handle);
}

function scorePost(p) {
  const ageH = (Date.now() - new Date(p.postedAt).getTime()) / 3600000;
  const velocity = (p.likesN + 3 * p.repliesN) / Math.max(ageH, 0.5);
  const recency = ageH < 2 ? 2 : ageH < 6 ? 1.5 : ageH < 24 ? 1 : 0.6;
  return Math.round(velocity * recency);
}

async function main() {
  const cmd = process.argv[2] ?? 'report';
  const needBrowser = cmd === 'scan';
  const conn = needBrowser ? await connect() : null;
  const { browser, ctx } = conn ?? {};
  const page = needBrowser ? await ctx.newPage() : null;

  if (cmd === 'scan') {
    const { targets } = JSON.parse(readFileSync('config/targets.json', 'utf8'));
    const all = existsSync(DATA_FILE) ? JSON.parse(readFileSync(DATA_FILE, 'utf8')) : {};
    let found = 0;
    for (const t of targets) {
      try {
        const posts = await scanProfile(page, t.handle);
        const fresh = [];
        for (const p of posts) {
          const rec = {
            handle: t.handle, lang: t.lang || 'zh', note: t.note || '',
            text: p.text, postedAt: p.postedAt,
            repliesN: parseCount(p.replies), retweetsN: parseCount(p.retweets), likesN: parseCount(p.likes),
          };
          rec.ageH = Math.round((Date.now() - new Date(p.postedAt).getTime()) / 360000) / 10;
          if (rec.ageH > 48 || rec.likesN + rec.repliesN < 3) continue;
          rec.score = scorePost(rec);
          if (!all[p.url]) { rec.foundAt = new Date().toISOString(); found++; }
          all[p.url] = { ...all[p.url], ...rec, url: p.url };
          fresh.push(p.url);
        }
        console.log(`@${t.handle.padEnd(16)} 抓到 ${posts.length} 帖，入库 ${fresh.length}`);
      } catch (e) {
        console.log(`@${t.handle.padEnd(16)} ⚠️ ${String(e).slice(0, 70)}`);
      }
      await page.waitForTimeout(2500 + Math.random() * 2000); // 拟人间隔
    }
    mkdirSync('data', { recursive: true });
    writeFileSync(DATA_FILE, JSON.stringify(all, null, 2));
    console.log(`\n新增机会 ${found} 条，队列总计 ${Object.keys(all).length} 条 → ${DATA_FILE}`);
  } else if (cmd === 'report') {
    const all = existsSync(DATA_FILE) ? Object.values(JSON.parse(readFileSync(DATA_FILE, 'utf8'))) : [];
    all.sort((a, b) => b.score - a.score);
    for (const p of all.slice(0, 15)) {
      console.log(`[${String(p.score).padStart(5)}] @${p.handle} · ${p.ageH}h前 · 👍${p.likesN} 💬${p.repliesN}`);
      console.log(`   ${p.text.replace(/\n/g, ' ').slice(0, 90)}`);
      console.log(`   ${p.url}`);
    }
    console.log(`\n共 ${all.length} 条机会`);
  }
  if (conn) await browser.close();
}

main().catch((e) => { console.error('失败:', e.message); process.exit(1); });
