// 增长中控台 · 审核看板
// 用法: node tools/server.mjs → http://localhost:7788
// 所有对外发送动作必须在这里由人工点击触发
import http from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { sendReply } from './x-send.mjs';
import { askLLM } from './llm.mjs';
import { config } from './config.mjs';
import { persona } from './persona.mjs';
import { connect } from './bridge.mjs';
import { buildPrompt, START_MARKER, END_MARKER } from './persona.mjs';

const DRAFT_FILE = 'data/drafts.json';
const OPP_FILE = 'data/opportunities.json';
const PORT = config.port;

const load = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {});
const save = (f, d) => writeFileSync(f, JSON.stringify(d, null, 2));

async function draftFor(url) {
  const opps = load(OPP_FILE);
  const post = opps[url];
  if (!post) throw new Error('机会队列里没有这条帖子');
  const { browser, ctx } = await connect();
  let draft;
  try { draft = await askLLM(ctx, buildPrompt(post), START_MARKER, END_MARKER); }
  finally { await browser.close(); }
  draft = draft.replace(/^["“」]|\s*["”」]$/g, '').trim();
  if (!draft) throw new Error('Grok 未返回有效草稿');
  const drafts = load(DRAFT_FILE);
  drafts[url] = { ...post, url, draft, status: 'pending', createdAt: new Date().toISOString() };
  save(DRAFT_FILE, drafts);
  return draft;
}

const page = `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>增长中控台 · 审核看板</title>
<style>
  body{font-family:-apple-system,'PingFang SC',sans-serif;background:#0f1115;color:#e7e9ee;margin:0;padding:24px}
  h1{font-size:20px} h2{font-size:15px;color:#9aa3b2;margin:28px 0 10px}
  .card{background:#181b22;border:1px solid #262b36;border-radius:10px;padding:14px 16px;margin-bottom:14px}
  .meta{color:#9aa3b2;font-size:12px;margin-bottom:6px}
  .meta b{color:#7db4ff;font-weight:600}
  .post{font-size:13px;color:#c6cbd4;line-height:1.5;margin:6px 0 10px;white-space:pre-wrap}
  textarea{width:100%;box-sizing:border-box;background:#0f1115;color:#e7e9ee;border:1px solid #303748;border-radius:8px;
    padding:10px;font-size:14px;line-height:1.6;min-height:72px;resize:vertical}
  button{border:0;border-radius:8px;padding:7px 14px;font-size:13px;cursor:pointer;margin-right:8px;margin-top:10px}
  .send{background:#1d9bf0;color:#fff}.re{background:#2a2f3a;color:#c6cbd4}.no{background:#3a2028;color:#ff8fa3}
  .tag{display:inline-block;font-size:11px;background:#22283a;color:#8fa8ff;border-radius:6px;padding:2px 8px;margin-right:6px}
  .sent{border-color:#1f5c3d}.sent .meta b{color:#4ade80}
  .row{display:flex;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid #20242e;font-size:13px}
  .row .score{color:#ffb454;width:44px}.row .txt{flex:1;color:#c6cbd4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .row a{color:#7db4ff;text-decoration:none}
  #status{color:#9aa3b2;font-size:13px;margin-left:8px}
  a.top{color:#7db4ff;font-size:13px;text-decoration:none}
</style></head><body>
<h1>🛰️ 增长中控台 · 审核看板 <a class="top" href="https://x.com/${persona.identity.handle}" target="_blank">@${persona.identity.handle}</a>
<button class="re" onclick="scan()">📡 扫描雷达</button><span id="status"></span></h1>
<h2>📥 待审核回复（发送前人工把关）</h2><div id="drafts"></div>
<h2>📡 机会队列（按互动速度排序 TOP20）</h2><div id="opps"></div>
<script>
const api = (p, b) => fetch(p, b ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)} : undefined).then(r=>r.json());
const esc = s => (s||'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
async function refresh(){
  const s = await api('/api/state');
  document.getElementById('drafts').innerHTML =
    s.drafts.length ? s.drafts.map(d => \`
    <div class="card \${d.status==='sent'?'sent':''}">
      <div class="meta"><b>@\${esc(d.handle)}</b> · \${d.ageH}h前 · 👍\${d.likesN} 💬\${d.repliesN} · 分值 \${d.score}
        · <a href="\${d.url}" target="_blank">原帖↗</a> <span class="tag">\${d.status==='sent'?'✅ 已发送':d.status==='rejected'?'❌ 已拒绝':'待审核'}</span></div>
      <div class="post">\${esc(d.text)}</div>
      <textarea id="t-\${encodeURIComponent(d.url)}">\${esc(d.draft)}</textarea>
      \${d.status==='pending' ? \`<button class="send" onclick="send('\${encodeURIComponent(d.url)}')">🚀 审核通过，发送回复</button>
        <button class="re" onclick="redraft('\${encodeURIComponent(d.url)}')">🔄 重新起草</button>
        <button class="no" onclick="reject('\${encodeURIComponent(d.url)}')">✖ 拒绝</button>\` : ''}
    </div>\`).join('') : '<div class="card meta">队列为空。先「扫描雷达」，再到机会队列点「起草」。</div>';
  document.getElementById('opps').innerHTML =
    s.opps.map(o => \`<div class="row"><span class="score">\${o.score}</span>
      <span style="width:130px"><b>@\${esc(o.handle)}</b></span>
      <span class="txt"><a href="\${o.url}" target="_blank">\${esc(o.text.replace(/\\n/g,' '))}</a></span>
      <span class="meta">\${o.ageH}h · 👍\${o.likesN} 💬\${o.repliesN}</span>
      <button class="re" onclick="draft('\${encodeURIComponent(o.url)}')">✍️ 起草</button></div>\`).join('') || '<div class="card meta">暂无机会，先扫描雷达。</div>';
}
const say = m => document.getElementById('status').textContent = m;
async function send(u){ if(!confirm('确认发送这条回复？'))return; say('发送中...');
  try{ const d = document.getElementById('t-'+u).value;
    const r = await api('/api/send',{url:decodeURIComponent(u),text:d}); say(r.ok?'✅ 已发送':'失败: '+r.error); }
  catch(e){ say('失败: '+e.message) } refresh(); }
async function draft(u){ say('Grok 起草中（约1-2分钟）...');
  try{ await api('/api/draft',{url:decodeURIComponent(u)}); say('✅ 草稿已生成'); }catch(e){ say('失败: '+e.message) } refresh(); }
async function redraft(u){ return draft(u); }
async function reject(u){ await api('/api/reject',{url:decodeURIComponent(u)}); say('已拒绝'); refresh(); }
async function scan(){ say('雷达扫描中（约2分钟）...'); try{ await api('/api/scan'); say('✅ 扫描完成'); }catch(e){ say('失败: '+e.message) } refresh(); }
refresh();
</script></body></html>`;

http.createServer(async (req, res) => {
  const body = await new Promise((r) => { let d = ''; req.on('data', (c) => d += c); req.on('end', () => r(d ? JSON.parse(d) : {})); });
  try {
    if (req.url === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(page); }
    if (req.url === '/api/state') {
      const drafts = Object.values(load(DRAFT_FILE)).sort((a, b) => (a.status === 'pending' ? -1 : 1) - (b.status === 'pending' ? -1 : 1));
      const opps = Object.values(load(OPP_FILE)).sort((a, b) => b.score - a.score).slice(0, 20);
      res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ drafts, opps }));
    }
    if (req.url === '/api/send') {
      const r = await sendReply(body.url, body.text);
      const drafts = load(DRAFT_FILE);
      if (drafts[body.url] && r.ok) { drafts[body.url].status = 'sent'; drafts[body.url].sentText = body.text; drafts[body.url].sentAt = new Date().toISOString(); save(DRAFT_FILE, drafts); }
      res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(r));
    }
    if (req.url === '/api/reject') {
      const drafts = load(DRAFT_FILE);
      if (drafts[body.url]) { drafts[body.url].status = 'rejected'; save(DRAFT_FILE, drafts); }
      res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: true }));
    }
    if (req.url === '/api/draft') {
      const draft = await draftFor(body.url);
      res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: true, draft }));
    }
    if (req.url === '/api/scan') {
      const { execFile } = await import('node:child_process');
      execFile('node', ['tools/radar.mjs', 'scan'], { cwd: process.cwd() }, () => {});
      res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: true, note: '扫描已在后台执行，约2分钟后刷新' }));
    }
    res.writeHead(404); res.end();
  } catch (e) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: e.message }));
  }
}).listen(PORT, () => console.log(`审核看板已启动: http://localhost:${PORT}`));
