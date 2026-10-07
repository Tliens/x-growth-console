// CDP 桥：连接自动化专用 Chrome（端口 9222，独立配置目录 ~/.xrobot/chrome-profile）
// 用法：
//   node tools/bridge.mjs status          # 连接状态 + 已打开标签页
//   node tools/bridge.mjs open <url>      # 新开标签页并打印标题
//   node tools/bridge.mjs login-check     # 逐平台检查登录状态（DOM 级判断）
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';

import { config } from './config.mjs';
const CDP_URL = config.cdpUrl;

export async function connect() {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const ctx = browser.contexts()[0];
  if (!ctx) throw new Error('没有可用的浏览器上下文');
  return { browser, ctx };
}

async function checkX(p) {
  await p.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await p.waitForTimeout(3500);
  if (/\/login|\/i\/onboarding|\/i\/flow/.test(p.url())) return '❌ 未登录';
  const nav = await p.locator('[data-testid="SideNav_AccountSwitcher_Button"]').count();
  return nav > 0 ? '✅ 已登录' : '⚠️ 状态不明';
}

async function checkCloudflare(p) {
  await p.goto('https://dash.cloudflare.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await p.waitForTimeout(4000);
  if (/\/login/.test(p.url())) return '❌ 未登录';
  if (/dash\.cloudflare\.com\/[0-9a-f]{16,}/.test(p.url())) return '✅ 已登录';
  return '⚠️ 状态不明';
}

async function checkJuejin(p) {
  await p.goto('https://juejin.cn/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await p.waitForTimeout(3000);
  const loginBtn = await p.locator('button:has-text("登录"), a:has-text("登录 / 注册")').count();
  return loginBtn > 0 ? '❌ 未登录' : '✅ 已登录(推测)';
}

async function checkV2EX(p) {
  await p.goto('https://www.v2ex.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await p.waitForTimeout(2000);
  const signin = await p.locator('a[href="/signin"], a[href="/signup"]').count();
  return signin > 0 ? '❌ 未登录' : '✅ 已登录(推测)';
}

async function checkPH(p) {
  await p.goto('https://www.producthunt.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await p.waitForTimeout(3500);
  const loginBtn = await p.locator('button:has-text("Log in"), a:has-text("Log in"), button:has-text("Sign up"), a:has-text("Sign up")').count();
  return loginBtn > 0 ? '❌ 未登录(推测)' : '✅ 已登录(推测)';
}

async function checkReddit(p) {
  await p.goto('https://www.reddit.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await p.waitForTimeout(3500);
  const loginBtn = await p.locator('login-button, [data-testid="login-button"], button:has-text("Log In")').count();
  return loginBtn > 0 ? '❌ 未登录(推测)' : '✅ 已登录(推测)';
}

const CHECKS = [
  ['X (Twitter)', checkX],
  ['Cloudflare', checkCloudflare],
  ['掘金', checkJuejin],
  ['V2EX', checkV2EX],
  ['Product Hunt', checkPH],
  ['Reddit', checkReddit],
];

async function main() {
  const cmd = process.argv[2] ?? 'status';
  const { browser, ctx } = await connect();

  if (cmd === 'status') {
    for (const p of ctx.pages()) {
      console.log(`- ${p.url()}  「${await p.title().catch(() => '?')}」`);
    }
    console.log(`共 ${ctx.pages().length} 个标签页`);
  } else if (cmd === 'open') {
    const url = process.argv[3];
    if (!url) throw new Error('用法: node tools/bridge.mjs open <url>');
    const p = await ctx.newPage();
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log(`已打开: ${p.url()}  「${await p.title()}」`);
  } else if (cmd === 'login-check') {
    for (const [name, fn] of CHECKS) {
      const p = await ctx.newPage();
      let result;
      try { result = await fn(p); }
      catch (e) { result = `⚠️ 检查失败: ${String(e).slice(0, 60)}`; }
      finally { await p.close(); }
      console.log(`${name.padEnd(14)} ${result}`);
    }
  } else {
    console.log('未知命令');
  }
  await browser.close();
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((e) => {
    console.error('失败:', e.message);
    console.error('提示: 自动化 Chrome 未运行? 运行 → open -na "Google Chrome" --args --remote-debugging-port=9222 --user-data-dir="$HOME/.xrobot/chrome-profile" --no-first-run --no-default-browser-check');
    process.exit(1);
  });
}
