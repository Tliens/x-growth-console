// 自动化回复循环（真人节奏版：间隔 1–6 分钟，全量机会池，like+阅读停顿拟人）
// 质量闸：--prepare 只起草（pending-auto），运行者审查/改写 data/drafts.json 后再 --send
// 用法：
//   node tools/autoreply.mjs --prepare [all|N]
//   node tools/autoreply.mjs --send
import { connect } from './bridge.mjs';
import { askLLM } from './llm.mjs';
import { config } from './config.mjs';
import { sendReply } from './x-send.mjs';
import { buildPrompt, pickStyle, START_MARKER, END_MARKER } from './persona.mjs';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const OPP_FILE = 'data/opportunities.json';
const DRAFT_FILE = 'data/drafts.json';
const load = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {});
const save = (f, d) => writeFileSync(f, JSON.stringify(d, null, 2));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shuffle = (a) => [...a].sort(() => Math.random() - 0.5);

// 疑似子回复/吵架帖：正文以 @ 开头或带明显对线特征的不回
const isRiskyPost = (p) => /^@/.test(p.text.trim()) || /出生|脑子|垃圾人|滚/.test(p.text);

async function prepare(arg) {
  const opps = Object.values(load(OPP_FILE))
    .filter((p) => p.lang === 'zh' && p.ageH <= 36 && p.likesN + p.repliesN >= 3 && !isRiskyPost(p));
  const drafts = load(DRAFT_FILE);
  const done = new Set(Object.keys(drafts).filter((u) => drafts[u].status !== 'rejected'));
  const pool = shuffle(opps.filter((p) => !done.has(p.url)).sort((a, b) => b.score - a.score).slice(0, 30));
  const n = arg === 'all' ? pool.length : Math.min(parseInt(arg || '3', 10), pool.length);
  const targets = pool.slice(0, n);
  if (!targets.length) { console.log('没有符合条件的新机会'); return; }

  const { browser, ctx } = await connect();
  let ok = 0;
  for (const [i, post] of targets.entries()) {
    const style = pickStyle();
    try {
      let draft = await askLLM(ctx, buildPrompt(post, style), START_MARKER, END_MARKER);
      draft = draft.replace(/^["“」]|\s*["”」]$/g, '').trim();
      if (!draft || draft.length > 160) throw new Error(`草稿不合格(长度${draft.length})`);
      drafts[post.url] = { ...post, url: post.url, draft, style: style.id, status: 'pending-auto', createdAt: new Date().toISOString() };
      save(DRAFT_FILE, drafts);
      ok += 1;
      console.log(`[${i + 1}/${targets.length}] ✅ [${style.id}] @${post.handle} → ${draft.replace(/\n/g, ' ')}`);
    } catch (e) {
      console.log(`[${i + 1}/${targets.length}] ⚠️ @${post.handle} 起草失败: ${String(e).slice(0, 80)}`);
    }
    await sleep(4000);
  }
  await browser.close();
  console.log(`\n起草完成 ${ok}/${targets.length} → 审查 data/drafts.json 后执行 --send`);
}

async function send() {
  const drafts = load(DRAFT_FILE);
  const pool = shuffle(Object.values(drafts).filter((d) => d.status === 'pending-auto'));
  // 1 小时内的新鲜帖插队最先发（截流有时效窗口），其余乱序
  const batch = [...pool.filter((d) => d.ageH < 1), ...pool.filter((d) => d.ageH >= 1)];
  if (!batch.length) { console.log('没有 pending-auto 的草稿'); return; }
  console.log(`待发送 ${batch.length} 条 | 间隔 1–6 分钟 | 每条回复附带 70% 概率点赞 | ${new Date().toLocaleTimeString('zh-CN')} 开始\n`);
  let sent = 0;
  for (const [i, d] of batch.entries()) {
    try {
      const r = await sendReply(d.url, d.draft, { like: Math.random() < 0.7 });
      if (!r.ok) throw new Error(r.error || '未知失败');
      drafts[d.url].status = 'sent';
      drafts[d.url].sentAt = new Date().toISOString();
      save(DRAFT_FILE, drafts);
      sent += 1;
      console.log(`[${i + 1}/${batch.length}] 🚀 @${d.handle} (${d.style}) → ${d.draft.replace(/\n/g, ' ')}`);
    } catch (e) {
      console.log(`[${i + 1}/${batch.length}] ❌ @${d.handle} 失败: ${String(e).slice(0, 100)}`);
    }
    if (i < batch.length - 1) {
      const [rMin, rMax] = config.intervals.reply;
      const wait = rMin + Math.round(Math.random() * (rMax - rMin));
      console.log(`    ⏳ 下一条 ${(wait / 60000).toFixed(1)} 分钟后`);
      await sleep(wait);
    }
  }
  save(DRAFT_FILE, drafts);
  const total = Object.values(drafts).filter((d) => d.status === 'sent').length;
  console.log(`\n本轮 ${sent}/${batch.length} 完成，累计已发送 ${total} 条`);
}

const cmd = process.argv[2];
if (cmd === '--prepare') prepare(process.argv[3] || '3').catch((e) => { console.error('失败:', e.message); process.exit(1); });
else if (cmd === '--send') send().catch((e) => { console.error('失败:', e.message); process.exit(1); });
else console.log('用法: node tools/autoreply.mjs --prepare [all|N] | --send');
