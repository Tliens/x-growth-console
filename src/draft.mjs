// 单帖起草器：为机会队列里的指定帖子起草一条回复（只起草，不发送）
// 用法：
//   node src/draft.mjs <帖子URL>     # 为指定机会起草
//   node src/draft.mjs --top         # 取当前分值最高的一条
import { connect } from './bridge.mjs';
import { askLLM } from './llm.mjs';
import { buildPrompt, pickStyle, START_MARKER, END_MARKER } from './persona.mjs';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const OPP_FILE = 'data/opportunities.json';
const DRAFT_FILE = 'data/drafts.json';

const load = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {});

async function main() {
  const arg = process.argv[2];
  if (!arg) throw new Error('用法: node src/draft.mjs <帖子URL> 或 --top');
  if (!existsSync(OPP_FILE)) throw new Error('机会队列为空，先跑 node src/radar.mjs scan');

  const opps = load(OPP_FILE);
  const post = arg === '--top'
    ? Object.values(opps).sort((a, b) => b.score - a.score)[0]
    : opps[arg];
  if (!post) throw new Error(`队列里没有这条帖子: ${arg}`);

  const style = pickStyle();
  console.log(`为 @${post.handle} 的帖子起草回复中（风格：${style.id}）...`);
  console.log(`原帖: ${post.text.replace(/\n/g, ' ').slice(0, 80)}\n`);
  const { browser, ctx } = await connect();
  let draft;
  try { draft = await askLLM(ctx, buildPrompt(post, style), START_MARKER, END_MARKER); }
  finally { await browser.close(); }

  draft = draft.replace(/^["“」]|\s*["”」]$/g, '').trim(); // 去首尾引号
  if (!draft) throw new Error('LLM 未返回有效草稿');

  const drafts = load(DRAFT_FILE);
  drafts[post.url] = { ...post, url: post.url, draft, style: style.id, status: 'pending', createdAt: new Date().toISOString() };
  writeFileSync(DRAFT_FILE, JSON.stringify(drafts, null, 2));

  console.log('=== 草稿（已进入待审核队列，不会自动发送）===');
  console.log(draft);
  console.log(`\n帖子: ${post.url}`);
  console.log(`队列: ${Object.keys(drafts).length} 条待审核 → 打开看板审核: node src/server.mjs`);
}

main().catch((e) => { console.error('失败:', e.message); process.exit(1); });
