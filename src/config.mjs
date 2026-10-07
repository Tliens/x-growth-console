// 统一配置加载：所有模块从这里读 config/config.json
import { readFileSync, existsSync } from 'node:fs';

const DEFAULTS = {
  llm: 'yuanbao',                      // 起草引擎: yuanbao | grok
  port: 7788,                          // 审核看板端口
  cdpUrl: 'http://localhost:9222',     // 自动化 Chrome 调试端口
  budgets: {
    dailyLikes: 30,                    // 每日点赞上限（新号保守值，蓝V可酌情加）
    dailyFollows: 12,                  // 每日关注上限（最敏感动作，宁少勿多）
    repliesPerBatch: 15,               // 每批起草回复条数
  },
  intervals: {                         // 毫秒区间，发送间隔在其中随机取值
    reply: [60000, 360000],            // 回复间隔 1–6 分钟
    like: [40000, 200000],             // 点赞间隔 40秒–3.3分钟
    follow: [240000, 600000],          // 关注间隔 4–10 分钟
  },
  likeChance: 0.7,                     // 回复原帖前顺手点赞的概率
  discovery: {                         // 关键词发现流
    keywords: [
      { kw: '独立开发', lang: 'zh' },
      { kw: '独立开发者', lang: 'zh' },
      { kw: 'build in public', lang: 'en' },
      { kw: '出海', lang: 'zh' },
      { kw: 'AI 工具', lang: 'zh' },
      { kw: 'vibe coding', lang: 'en' },
    ],
  },
};

const file = 'config/config.json';
const user = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};

// 浅合并两层（budgets/intervals/discovery 允许部分覆盖）
export const config = {
  ...DEFAULTS, ...user,
  budgets: { ...DEFAULTS.budgets, ...(user.budgets || {}) },
  intervals: {
    reply: [...(user.intervals?.reply || DEFAULTS.intervals.reply)],
    like: [...(user.intervals?.like || DEFAULTS.intervals.like)],
    follow: [...(user.intervals?.follow || DEFAULTS.intervals.follow)],
  },
  discovery: { keywords: user.discovery?.keywords || DEFAULTS.discovery.keywords },
};
