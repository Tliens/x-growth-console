// 回关循环：每 10 分钟检查粉丝列表，回关关注自己的人
// 用法: node tools/followback.mjs
// 关键设计：
//   - 列表页直接读按钮状态：已回关的是 Following，自动跳过，绝不重复
//   - 全局关注熔断：当日全部关注（engage+互粉+回关）达 380 停手（X 平台硬上限 400）
//   - 每轮最多回关 8 个，避免突发集中
import { connect } from './bridge.mjs';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const ENGAGE_FILE = 'data/engagement.json';
const FB_FILE = 'data/followback.json';
const FOLLOWERS_URL = 'https://x.com/kuige_me/verified_followers';
const GLOBAL_DAILY_CAP = 380;   // 当日全渠道关注总量熔断线
const PER_ROUND = 8;            // 每轮最多回关数
const ROUND_MINUTES = 10;
const OWN_HANDLE = 'kuige_me';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = () => new Date().toISOString().slice(0, 10);
const load = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {});
const save = (f, d) => writeFileSync(f, JSON.stringify(d, null, 2));

function dailyFollowCount() {
  const e = load(ENGAGE_FILE);
  const fb = load(FB_FILE);
  const engaged = (e[today()]?.follows || []).length;
  const backed = (fb[today()] || []).length;
  return { engaged, backed, total: engaged + backed };
}

async function round(ctx) {
  const { total } = dailyFollowCount();
  if (total >= GLOBAL_DAILY_CAP) {
    console.log(`⛔ 当日关注已达 ${total}/${GLOBAL_DAILY_CAP}，本轮跳过`);
    return 0;
  }
  const page = await ctx.newPage();
  let done = 0;
  try {
    await page.goto(FOLLOWERS_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4500);
    if (/\/login/.test(page.url())) throw new Error('X 未登录');
    // 滚 4 屏覆盖最新粉丝（列表大致按关注时间倒序）
    for (let i = 0; i < 4; i++) {
      await page.mouse.wheel(0, 1600);
      await page.waitForTimeout(1500);
    }
    // 列表页内直接找未回关者（Follow 按钮），点击后按钮变 Following
    const targets = await page.evaluate(({ cap, me }) => {
      const out = [];
      for (const cell of document.querySelectorAll('div[data-testid="cellInnerDiv"]')) {
        const btn = cell.querySelector('button[data-testid$="-follow"]');
        const link = cell.querySelector('a[href^="/"]');
        if (btn && link) {
          const handle = new URL(link.href, 'https://x.com').pathname.split('/')[1];
          if (handle && handle.toLowerCase() !== me) out.push(handle);
        }
        if (out.length >= cap) break;
      }
      return out;
    }, { cap: Math.min(PER_ROUND, GLOBAL_DAILY_CAP - total), me: OWN_HANDLE.toLowerCase() });

    for (const handle of targets) {
      if (done >= PER_ROUND || total + done >= GLOBAL_DAILY_CAP) break;
      try {
        // 逐个重查该 cell 的按钮（列表随点击会重渲染，位置会变）
        const btn = page.locator(`div[data-testid="cellInnerDiv"]:has(a[href="/${handle}"]) button[data-testid$="-follow"]`).first();
        if ((await btn.count()) === 0) continue; // 已回关（按钮已是 Following）
        await btn.click();
        done += 1;
        const state = load(FB_FILE);
        state[today()] = state[today()] || [];
        state[today()].push(handle);
        save(FB_FILE, state);
        console.log(`🔄 回关 @${handle}（本轮 ${done}/${targets.length}，今日 ${total + done}/${GLOBAL_DAILY_CAP}）`);
      } catch (e) {
        console.log(`⚠️ 回关 @${handle} 失败: ${String(e).slice(0, 50)}`);
      }
      await sleep(2000 + Math.random() * 8000); // 回关间隔 2–10 秒：真人刷粉丝列表连点节奏
    }
  } finally {
    await page.close();
  }
  return done;
}

async function main() {
  const { browser, ctx } = await connect();
  console.log(`回关循环启动：每 ${ROUND_MINUTES} 分钟一轮，每轮≤${PER_ROUND}，全局熔断 ${GLOBAL_DAILY_CAP}/天`);
  // 启动即跑第一轮，之后固定间隔
  while (true) {
    const ts = new Date().toLocaleTimeString('zh-CN');
    try {
      const n = await round(ctx);
      if (n === 0) console.log(`[${ts}] 本轮无待回关（或已达熔断线）`);
      else console.log(`[${ts}] 本轮回关 ${n} 人`);
    } catch (e) {
      console.log(`[${ts}] ⚠️ 本轮失败: ${String(e).slice(0, 80)}`);
    }
    await sleep(ROUND_MINUTES * 60000);
  }
}

main().catch((e) => { console.error('失败:', e.message); process.exit(1); });
