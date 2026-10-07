# X 半自动互动中控台：从零跑起来

> 机器找机会、AI 起草、人扣扳机。跑在你自己的电脑上，用真实 Chrome 的登录态，0 元 API 费。本文前半部分是可复制粘贴的上手步骤，后半部分讲实现原理，给想改代码的人。

## 1. 它是什么（30 秒版）

```
目标库 + 关键词发现流
      ↓
雷达扫描（按"互动速度"给帖子打分）
      ↓
LLM 起草（按你的人设 + 随机风格卡）
      ↓
人工审核看板（本地网页，逐条把关）
      ↓
拟人发送（随机间隔、先读后动、顺手点赞）
      ↓
数据回流（机会队列 / 互动明细 / 限流体检）
```

自动化的是**筛选和起草**，不是**发表**——每一条对外内容都过人工审核。这是它和"全自动刷量机器人"的本质区别，也是账号能活下来的原因。

## 2. 准备

- Node.js ≥ 18（`node -v` 检查）
- 本机装有 Chrome（macOS 实测可用；Linux 把 `setup.sh` 里的启动命令换成本机 Chrome 路径；Windows 未测试）
- 一个想认真经营的 X 账号
- 一个网页版 LLM 的账号：**腾讯元宝**（yuanbao.tencent.com，默认引擎，免费额度宽裕）或 Grok（x.com/i/grok，有实时 X 数据但免费额度小）

## 3. 快速开始（约 15 分钟）

### 第 1 步：初始化（2 分钟）

```bash
# 拿到代码：git clone 或直接解压发行包
cd x-growth-console
bash setup.sh
```

这条脚本做两件事：**启动一个自动化专用 Chrome**（独立配置目录，和你日常用的 Chrome 并存互不干扰），然后 `npm install`（只装 playwright-core，不下载浏览器）。

> 为什么是独立配置目录：Chrome 136+ 禁止在默认用户目录上开调试端口（`--remote-debugging-port` 会直接失效），这是官方安全限制，绕不开，只能用独立目录。

### 第 2 步：登录（一次性，2 分钟）

在**刚弹出的那个 Chrome 窗口**里登录两个站点：

1. `x.com` —— 必须
2. `yuanbao.tencent.com` —— 起草引擎（想用 Grok 就登 grok，并把 `config/config.json` 里 `"llm"` 改成 `"grok"`）

登录态永久保留在这个专用目录里，以后不用再登。验证：

```bash
node src/bridge.mjs login-check
# 输出 X (Twitter) ✅ 已登录 即通过
```

### 第 3 步：写人设（5 分钟，**决定草稿质量的一步**）

编辑 `config/persona.json`，把 `identity.bio` 换成你的真实人设。好的人设长这样（越具体越好）：

```
杭州独立开发者；8 年前端；做过一个 3 万用户的开源工具；
正在公开构建 XX；只聊能落地的技术。
```

其他字段按需调整，注意三个：

- `replyRules` 最后一条是"适度爆粗口"，不想要就删掉这条
- `hardRules` 是反 AI 腔的硬规则（禁总结式收尾、禁排比、禁书面连接词），建议保留
- `maxReplyLen: 120`——回复超过 120 字在时间线上会被折叠，别调太大

### 第 4 步：配目标和关键词（3 分钟）

- `config/targets.json`：换成**你领域里真正在活跃**的账号。挑号标准：500–20 万粉、近三天发过帖、是人不是官号。10 个就够起步
- `config/config.json` 的 `discovery.keywords`：换成你领域的词（如做设计工具就写"UI 设计 / Figma / design tools"）

### 第 5 步：跑第一轮循环（10 分钟机器时间 + 10 分钟你的时间）

```bash
# ① 刷新机会池（关键词搜索，~1 分钟）
node src/discover.mjs

# ② 扫描目标账号（每个号约 8 秒，10 个号 2 分钟内）
node src/radar.mjs scan

# ③ 看一眼当前机会队列
node src/radar.mjs report

# ④ 批量起草——注意：只起草，不会发送任何内容
node src/autoreply.mjs --prepare all
#    输出形如：[3/10] ✅ [经验] @某人 → 草稿正文……

# ⑤ 打开审核看板（默认 http://localhost:7788）
node src/server.mjs
#    逐条看：可以编辑后发送、一键重新起草、拒绝
#    也可以直接改 data/drafts.json：把不要的 status 改成 rejected

# ⑥ 人工把关之后，才真正发送（随机间隔 1–6 分钟/条）
node src/autoreply.mjs --send

# ⑦ 点赞 + 关注按日限额自动跑（默认赞 30/天、关注 12/天）
node src/engage.mjs --auto
```

第一次跑完你会得到：一批已经发出的回复 + 一个 `data/` 目录（机会队列、草稿、互动明细都在里面）。

### 第 6 步：引用和转推（可选）

```bash
node src/amplify.mjs --quote-draft <帖子URL>    # 起草引用语（待审，不发）
node src/amplify.mjs --quote-send <帖子URL>     # 审核满意后发送
node src/amplify.mjs --rt <帖子URL>             # 转推（低风险，直接执行）
```

### 日常节奏（每天 30 分钟）

```
早晨：discover → scan → prepare → 审核 → send
白天：engage 自己跑（限额到了自动停）
随手：看到好帖 quote/rt 一条
每晚：看板上把 rejected 的理由过一遍，反哺 persona.json
```

## 4. 质量闸：审核时必查的 5 个点

机器起草的稿子 80% 能直接用，剩下 20% 靠你拦。每条过一遍：

1. **数字有没有编**：LLM 会捏造"2015 年以来新高"这种细节，原帖没说的数字一律删
2. **和已发回复撞不撞车**：同一个人两条帖，观点不能复读（圈子小，会被看出来）
3. **有没有对第三方下断言**：猜测性评价别人业务（"他这是加杠杆"）说错很难看
4. **有没有擦边**：给灰产方法支招、评价你不想被截图的内容
5. **是不是在接吵架**：正文以 @ 开头的帖子别回，赢了没收益，输了结怨

拒绝的稿子别静默删——`status` 改成 `rejected` 留档，每周扫一眼拒绝理由，回头改 `persona.json`，草稿质量会肉眼可见地变好。

## 5. 风控红线

系统内置的拟人化（已默认开启，无需配置）：

- 每条回复间隔 1–6 分钟随机（`config.json` 可调）
- 进帖子先随机滚动、停留 5–18 秒再动手
- 70% 概率先赞原帖再回复
- 发送顺序打乱，回复/点赞/关注/转推混着来
- 关注前过简介相关性闸（bio 没有行业关键词的账号直接跳过）

必须遵守的红线：

1. **不做私信**——冷 DM 是被举报的头号来源
2. **不做关注后取关**——平台检测最狠的行为
3. **回复必人审**——AI 直接对外发，翻车只是时间问题
4. **额度爬坡**——新号从默认值（赞 30 / 关注 12 / 回复 15）起步，连续几天无异常再加；账号状态越好，限额可以越高
5. **定期体检**——搜一下 `from:你的handle`，内容能被检索 = 没被限流；搜不到就立即停手静养

## 6. 技术实现速览（想改代码的看这里）

### 6.1 CDP 接管真 Chrome

不用官方 API（按量付费，读帖监控场景费用会滚起来），也不用无头浏览器（指纹假、登录态难搞）。用 playwright-core 通过 CDP 连接一个**真实 Chrome**：

```js
import { chromium } from 'playwright-core';
const browser = await chromium.connectOverCDP('http://localhost:9222');
const ctx = browser.contexts()[0];   // 你登录过的真实会话
```

`browser.close()` 只断开连接，不杀 Chrome。

### 6.2 打分：互动速度，不是绝对互动量

小号蹭曝光靠**抢前排**——大 V 发帖后 5–15 分钟内的高赞帖最有价值：

```js
const ageH = (Date.now() - new Date(postedAt)) / 3600000;
const velocity = (likes + 3 * replies) / Math.max(ageH, 0.5);  // 有讨论的帖才值得回
const recencyBoost = ageH < 2 ? 2 : ageH < 6 ? 1.5 : ageH < 24 ? 1 : 0.6;
const score = Math.round(velocity * recencyBoost);
```

### 6.3 从聊天页面里干净抠出 LLM 回答：双标记法

起草引擎用的是**网页版 LLM**（元宝/Grok），不走 API，所以要解决"怎么把回答从整个页面文本里抠出来"。方法：提示词尾部埋一个起始标记，要求模型答完输出结束标记，两头一夹：

```
……提示词……（回复指令结束）只输出回复正文。输出完毕后另起一行单独输出 [[END]]
```

```js
// 取"（回复指令结束）"之后、"[[END]]"之前的文本，中间夹一个界面噪音词典
const idx = lines.map(l => l.includes(START_MARKER)).lastIndexOf(true);
if (idx >= 0) lines = lines.slice(idx + 1);
```

**两个必踩的坑**（都真实踩过）：

1. **会话残留污染**：网页版 LLM 会恢复上次会话，之前测试留下的 `[[END]]` 还在页面里，"出现 2 次即完成"的判断当场误触发，抓回来全是界面文字。解法：每次提问先点「新建对话」
2. **长提示词回显截断**：用户气泡过长时页面只显示前几行 + "展开"按钮，起始标记可能不在 innerText 里。所以结束标记（`[[END]]`）是更可靠的完成信号——它是模型自己输出的，一定出现在回答末尾

### 6.4 DOM 解析细节

- 帖子在 `article[data-testid="tweet"]`，正文 `[data-testid="tweetText"]`，时间 `<time datetime>`
- **互动数在按钮的 aria-label 里**，格式本地化混杂：`1.2万`、`105`、`9.2K` 都有，统一正则解析：

```js
const m = s.replace(/,/g, '').match(/([\d.]+)\s*(万|[KM]?)/);
if (m[2] === '万') v *= 1e4; else if (m[2] === 'K') v *= 1e3; ...
```

- **置顶帖和转推必须过滤**：看 `[data-testid="socialContext"]` 是否含"置顶/Pinned/转推了"，否则你会把别人的爆款当成目标作者的内容去回复

### 6.5 发送端

```js
await page.locator('[data-testid="tweetTextarea_0"]').click();
await page.keyboard.insertText(text);
await page.locator('[data-testid="tweetButtonInline"]').click();
```

先跑 dry-run（`x-send.mjs --dry`）：同一个流程填入文本、检查按钮状态，但不点发送。全链路验证过再放行真实发送。

## 7. 故障排查

| 症状 | 原因 | 解法 |
|---|---|---|
| `ECONNREFUSED localhost:9222` | 自动化 Chrome 没开 | 重跑 `bash setup.sh` |
| `X 未登录` | 登录态丢失/没用专用 Chrome | 在自动化 Chrome 窗口里重新登录 |
| LLM 返回界面文字/乱码 | 会话残留或回显截断 | 确认代码里每次提问前点了「新建对话」（已内置） |
| `找不到回复输入框` | X 前端改版，选择器失效 | 打开帖子页 F12 查新的 `data-testid`，更新 `x-send.mjs` |
| `from:我` 搜不到内容 | 触发了限流 | 立即停手 48 小时，删掉当天可疑动作，降低 `config.json` 里的预算 |
| 草稿千篇一律 | 人设太泛/风格卡没生效 | `persona.json` 的 bio 写具体成绩和领域；确认 `pickStyle` 在每次起草时被调用 |

## 8. 目录与数据

```
├── setup.sh              # 初始化：启动专用 Chrome + 装依赖
├── config/
│   ├── config.json       # 引擎/端口/预算/间隔/关键词
│   ├── persona.json      # 你的人设
│   └── targets.json      # 监控目标账号
├── src/                  # 13 个模块，见 README 目录说明
└── data/                 # 运行时生成
    ├── opportunities.json   # 机会队列（跨天去重）
    ├── drafts.json          # 草稿与状态（pending-auto → sent/rejected）
    ├── engagement.json      # 点赞/关注/转推/引用明细
    └── metrics.json         # 每日账号状态快照
```

所有状态都是本地 JSON，想回溯、想分析、想迁移，直接读文件。

---

*把这套系统当"放大器"而不是"代练"：它替你找机会、起草、守节奏，但每一条发出去的话，责任和收益都是你的。*
