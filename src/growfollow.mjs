// 互粉策略：刷首页时间线捞互粉帖 → 话术池评论 → 关注发帖人 + 评论区活跃者
// 用法：
//   node tools/growfollow.mjs --plan    # 只滚动时间线，列出计划动作，不发不关注
//   node tools/growfollow.mjs --auto    # 执行（评论+关注，每动作间隔 30–100 秒）
//
// 来源：首页 For you 时间线（X 自己推荐的互粉帖）。刷首页顺手互动，比搜索更像真人
// 风控设计：
//   - 4 条话术随机池 × 程序化变体（结尾随机加 emoji/语气词）→ 避免完全相同文本批量发布
//   - 关注去重基于全历史日志 + 页面按钮状态双保险；已关注自动跳过，永不取关
//   - 日预算：评论 40 / 互粉关注 30（想激进自己改，量级越大风险越高）
import { connect } from './bridge.mjs';
import { persona } from './persona.mjs';
import { sendReply } from './x-send.mjs';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const ENGAGE_FILE = 'data/engagement.json';
const GROWTH_RE = /互粉|互关|互fo|互FO|关注必回|必回|回关|不取关|先上岸/i;
const DAILY_COMMENTS = 40;
const DAILY_FOLLOWS = 360;         // 互粉关注预算。X 平台硬上限 400/天（engage 另有 12），留余量防撞限
const REPLIES_PER_POST = 15;       // 每帖最多关注前 N 个回复者
const PER_ACTION = [30000, 100000]; // 每个动作间隔 30–100 秒
const OWN_HANDLE = persona.identity.handle;
const SCROLL_ROUNDS = 30;          // 首页滚动轮数（360 关注需要更大的帖子池）

const COMMENTS = [
  '互关，必回，先上岸再说',
  '搞起，互粉  还能关注 200 人',
  '我是老号，互粉，质量高，不取关',
  '不取关的来，互粉',
];
const TAILS = ['', ' 🙏', ' 🤝', ' 💪', '~', '！'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = () => new Date().toISOString().slice(0, 10);
const load = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {});
const save = (f, d) => writeFileSync(f, JSON.stringify(d, null, 2));
const shuffle = (a) => [...a].sort(() => Math.random() - 0.5);

function pickComment() {
  return (COMMENTS[Math.floor(Math.random() * COMMENTS.length)] + TAILS[Math.floor(Math.random() * TAILS.length)]).trim();
}

function growthState() {
  const s = load(ENGAGE_FILE);
  if (!s[today()]) s[today()] = { likes: [], follows: [] };
  s.growth = s.growth || { comments: [], follows: [] }; // 全历史，跨天去重
  return s;
}

// 刷首页 For you 时间线，捞命中互粉关键词的帖子：返回 [{url, handle, text}]
async function findPosts(page) {
  const out = new Map();
  await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4500);
  if (/\/login/.test(page.url())) throw new Error('X 未登录');
  for (let round = 0; round < SCROLL_ROUNDS; round++) {
    const posts = await page.evaluate(() => {
      const res = [];
      for (const a of document.querySelectorAll('article[data-testid="tweet"]')) {
        const link = [...a.querySelectorAll('a[href*="/status/"]')][0];
        const t = a.querySelector('[data-testid="tweetText"]');
        if (!link || !t) continue;
        const path = new URL(link.href, 'https://x.com').pathname;
        res.push({ url: `https://x.com${path}`, handle: path.split('/')[1], text: t.innerText });
      }
      return res;
    });
    let n = 0;
    for (const p of posts) {
      if (!GROWTH_RE.test(p.text)) continue;
      if (p.handle.toLowerCase() === OWN_HANDLE) continue;
      if (!out.has(p.url)) { out.set(p.url, { ...p, text: p.text.slice(0, 80) }); n++; }
    }
    process.stdout.write(`第${round + 1}轮：累计互粉帖 ${out.size}（本轮+${n}）\n`);
    if (out.size >= 120) break; // 够一天的量就停
    await page.mouse.wheel(0, 1800 + Math.random() * 1200);
    await page.waitForTimeout(2200 + Math.random() * 2500);
  }
  return [...out.values()];
}

// 抓帖子评论区的前 N 个回复者 handle
async function replyAuthors(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000 + Math.random() * 3000);
  await page.mouse.wheel(0, 2000);
  await page.waitForTimeout(2000);
  return page.evaluate((lim) => {
    const handles = [];
    for (const a of [...document.querySelectorAll('article[data-testid="tweet"]')].slice(1)) {
      const link = [...a.querySelectorAll('a[href*="/status/"]')].pop();
      if (link) handles.push(new URL(link.href, 'https://x.com').pathname.split('/')[1]);
      if (handles.length >= lim) break;
    }
    return handles;
  }, REPLIES_PER_POST);
}

// 关注一个人，返回 true=执行了关注 / false=跳过（已关注或不可关注）
async function followOne(page, handle) {
  await page.goto(`https://x.com/${handle}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3500 + Math.random() * 4000);
  const btn = page.locator('button[data-testid$="-follow"]').first();
  if ((await btn.count()) === 0) return false;
  await btn.click();
  await page.waitForTimeout(1200);
  return true;
}

async function main() {
  const cmd = process.argv[2];
  if (!['--plan', '--auto'].includes(cmd)) {
    console.log('用法: node tools/growfollow.mjs --plan | --auto');
    return;
  }
  const state = growthState();
  const doneComments = new Set(state.growth.comments);
  const doneFollows = new Set(state.growth.follows);
  const { browser, ctx } = await connect();
  const page = await ctx.newPage();

  console.log('搜索互粉帖中...');
  const posts = await findPosts(page);
  console.log(`候选互粉帖 ${posts.length} 条`);
  if (cmd === '--plan') {
    for (const p of posts.slice(0, 15)) console.log(`  @${p.handle}: ${p.text.replace(/\n/g, ' ').slice(0, 50)}\n    ${p.url}`);
    console.log(`\n计划：${Math.min(posts.length, DAILY_COMMENTS)} 条评论 + 关注发帖人和评论区活跃者（${DAILY_FOLLOWS}/天上限）`);
    await browser.close();
    return;
  }

  // 构建动作队列：评论 → 关注发帖人 →（进帖时顺路抓）评论区关注
  const queue = [];
  for (const p of shuffle(posts)) {
    if (!doneComments.has(p.url) && queue.filter((q) => q.type === 'comment').length < DAILY_COMMENTS) {
      queue.push({ type: 'comment', url: p.url, handle: p.handle });
    }
  }
  shuffle(queue);
  console.log(`\n开始执行：${queue.length} 条评论 + 关注（动作间隔 30–100 秒）\n`);

  let comments = 0, follows = 0;
  for (const [i, action] of queue.entries()) {
    if (comments >= DAILY_COMMENTS && follows >= DAILY_FOLLOWS) break;

    // 1. 评论互粉帖
    if (action.type === 'comment' && comments < DAILY_COMMENTS) {
      try {
        const text = pickComment();
        const r = await sendReply(action.url, text, { like: Math.random() < 0.5 });
        if (!r.ok) throw new Error(r.error);
        comments += 1;
        state.growth.comments.push(action.url);
        save(ENGAGE_FILE, state);
        console.log(`[${i + 1}/${queue.length}] 💬 @${action.handle} → ${text}`);
        await sleep(PER_ACTION[0] + Math.random() * (PER_ACTION[1] - PER_ACTION[0]));

        // 2. 关注发帖人 + 评论区活跃者（进同一个帖子顺路做）
        if (follows < DAILY_FOLLOWS && !doneFollows.has(action.handle) && action.handle.toLowerCase() !== OWN_HANDLE) {
          if (await followOne(page, action.handle)) {
            follows += 1;
            state.growth.follows.push(action.handle);
            state[today()].follows.push(action.handle); // 同步计入 engage 的当日总账
            save(ENGAGE_FILE, state);
            console.log(`    ➕ 关注发帖人 @${action.handle}`);
          } else console.log(`    ⏭️ @${action.handle} 已关注/不可关`);
          await sleep(PER_ACTION[0] + Math.random() * (PER_ACTION[1] - PER_ACTION[0]));
        }
        if (follows < DAILY_FOLLOWS) {
          const repliers = await replyAuthors(page, action.url);
          for (const h of repliers) {
            if (follows >= DAILY_FOLLOWS) break;
            if (h.toLowerCase() === OWN_HANDLE || doneFollows.has(h.toLowerCase()) || state.growth.follows.includes(h)) continue;
            try {
              if (await followOne(page, h)) {
                follows += 1;
                state.growth.follows.push(h);
                state[today()].follows.push(h);
                save(ENGAGE_FILE, state);
                console.log(`    ➕ 关注回复者 @${h}`);
              }
            } catch { /* 单人失败不中断 */ }
            await sleep(PER_ACTION[0] + Math.random() * (PER_ACTION[1] - PER_ACTION[0]));
          }
        }
      } catch (e) {
        console.log(`[${i + 1}/${queue.length}] ❌ @${action.handle}: ${String(e).slice(0, 70)}`);
        await sleep(PER_ACTION[0] + Math.random() * (PER_ACTION[1] - PER_ACTION[0]));
      }
    }
  }
  await page.close();
  await browser.close();
  console.log(`\n互粉循环结束：评论 ${comments}/${DAILY_COMMENTS}，关注 ${follows}/${DAILY_FOLLOWS}`);
}

main().catch((e) => { console.error('失败:', e.message); process.exit(1); });
