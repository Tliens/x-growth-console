// 互动自动化（保守档）：独立点赞 + 关注，硬性日限额，混插节奏拟人
// 用法: node tools/engage.mjs --auto
// 限额写死在代码里：新号阶段 点赞≤30/天 关注≤12/天，想调改这里
import { connect } from './bridge.mjs';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { config } from './config.mjs';
import { persona } from './persona.mjs';

const OPP_FILE = 'data/opportunities.json';
const ENGAGE_FILE = 'data/engagement.json';
const XHOT_DIR = 'data/xhot';
const DAILY_LIKES = config.budgets.dailyLikes;
const DAILY_FOLLOWS = config.budgets.dailyFollows;
// 自己的号 + 目标库里的号不作为关注候选
const SEEDS = new Set([
  persona.identity.handle,
  ...(existsSync('config/targets.json') ? JSON.parse(readFileSync('config/targets.json', 'utf8')).targets.map((t) => t.handle) : []),
].map((h) => (h || '').toLowerCase()));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = () => new Date().toISOString().slice(0, 10);
const load = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {});
const save = (f, d) => writeFileSync(f, JSON.stringify(d, null, 2));
const shuffle = (a) => [...a].sort(() => Math.random() - 0.5);

function engageState() {
  const s = load(ENGAGE_FILE);
  if (!s[today()]) s[today()] = { likes: [], follows: [] };
  return s;
}

function followCandidates() {
  const files = existsSync(XHOT_DIR) ? readdirSync(XHOT_DIR).filter((f) => f.startsWith('snapshot-')) : [];
  const out = [];
  for (const f of files) {
    const snap = JSON.parse(readFileSync(`${XHOT_DIR}/${f}`, 'utf8'));
    for (const c of snap.creators || []) {
      if (c.category !== '独立开发') continue;
      if (c.followers < 800 || c.followers > 150000) continue; // 只要会互动的真人档位
      if (SEEDS.has(c.handle.toLowerCase())) continue;
      out.push({ handle: c.handle, name: c.name, followers: c.followers, rank: c.rank, src: 'xhot' });
    }
  }
  return shuffle(out);
}

async function main() {
  const cmd = process.argv[2];
  if (cmd !== '--auto') { console.log('用法: node tools/engage.mjs --auto'); return; }

  const state = engageState();
  const opps = Object.values(load(OPP_FILE)).filter((p) => p.lang === 'zh' && p.ageH <= 48);
  const likedSet = new Set(state[today()].likes);
  const likePool = shuffle(opps.filter((p) => !likedSet.has(p.url) && !p.text.startsWith('@'))).slice(0, DAILY_LIKES);
  const extra = existsSync('data/follow-extra.json') ? JSON.parse(readFileSync('data/follow-extra.json', 'utf8')) : [];
  // 机会队列里出现过的作者也是优质候选（在圈内发帖的活跃真人），过简介相关性闸
  const authorSet = new Set(Object.values(load(OPP_FILE)).map((p) => p.handle).filter((h) => h && !SEEDS.has(h.toLowerCase())));
  const authorCands = [...authorSet].map((h) => ({ handle: h, name: h, src: 'opps', followers: 0, rank: 0 }));
  const followPool = [...followCandidates(), ...shuffle(authorCands), ...shuffle(extra).map((c) => ({ handle: c.handle, name: c.handle, src: c.src || 'replies', followers: 0, rank: 0 }))];
  const followedSet = new Set(state[today()].follows);

  console.log(`互动循环启动：待赞 ${likePool.length}（限额${DAILY_LIKES}）| 待关注候选 ${followPool.length}（限额${DAILY_FOLLOWS}）`);
  const { browser, ctx } = await connect();
  const page = await ctx.newPage();
  let likes = 0, follows = 0;

  while (likes < DAILY_LIKES || follows < DAILY_FOLLOWS) {
    const doLike = likes < DAILY_LIKES && likePool.length && (follows >= DAILY_FOLLOWS || Math.random() < 0.65);
    if (doLike) {
      const post = likePool.shift();
      try {
        await page.goto(post.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(3500 + Math.random() * 6000);
        const btn = page.locator('[data-testid="like"]').first(); // 已赞过时 testid 会变成 unlike，自然跳过
        if ((await btn.count()) > 0) {
          await btn.click();
          likes += 1;
          state[today()].likes.push(post.url);
          save(ENGAGE_FILE, state);
          console.log(`❤️ [${likes}/${DAILY_LIKES}] 赞了 @${post.handle}: ${post.text.replace(/\n/g, ' ').slice(0, 40)}`);
        }
      } catch (e) { console.log(`⚠️ 赞失败 @${post.handle}: ${String(e).slice(0, 60)}`); }
      const [lMin, lMax] = config.intervals.like; await sleep(lMin + Math.random() * (lMax - lMin));
      continue;
    }
    if (follows < DAILY_FOLLOWS && followPool.length) {
      const c = followPool.shift();
      try {
        await page.goto(`https://x.com/${c.handle}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(4000 + Math.random() * 5000);
        // 相关性闸：非榜单来源的候选，简介/昵称必须带圈内关键词，否则跳过（过滤官号和路人）
        const REL = /开发|程序|独立|代码|工程师|出海|创业|产品|工具|网站|编程|code|dev|build|AI|黑客|全栈|前端|后端|独立开发/i;
        if (c.src !== 'xhot') {
          const bio = await page.evaluate(() => {
            const d = document.querySelector('[data-testid="UserDescription"]');
            const n = document.querySelector('[data-testid="UserName"]');
            return `${d ? d.innerText : ''} ${n ? n.innerText : ''}`;
          });
          if (!REL.test(bio)) { console.log(`⏭️ @${c.handle} 简介不相关，跳过`); continue; }
        }
        const btn = page.locator('button[data-testid$="-follow"]').first(); // 已关注时 testid 是 -unfollow，自然跳过
        if ((await btn.count()) > 0) {
          await btn.click();
          follows += 1;
          state[today()].follows.push(c.handle);
          save(ENGAGE_FILE, state);
          console.log(`➕ [${follows}/${DAILY_FOLLOWS}] 关注了 @${c.handle}（${c.followersRaw || c.followers || c.src}，榜#${c.rank || '-'}）`);
        } else {
          console.log(`⏭️ @${c.handle} 已关注或不可关，跳过`);
        }
      } catch (e) { console.log(`⚠️ 关注失败 @${c.handle}: ${String(e).slice(0, 60)}`); }
      const [fMin, fMax] = config.intervals.follow; await sleep(fMin + Math.random() * (fMax - fMin));
      continue;
    }
    break;
  }
  await browser.close();
  console.log(`\n互动循环结束：点赞 ${likes}/${DAILY_LIKES}，关注 ${follows}/${DAILY_FOLLOWS}（明细见 data/engagement.json）`);
}

main().catch((e) => { console.error('失败:', e.message); process.exit(1); });
