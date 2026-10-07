# X Growth Console · 半自动互动中控台

一套跑在自己电脑上的 X（Twitter）互动系统：**机器找机会 → LLM 起草 → 人工审核 → 拟人发送**。

> 设计原则：自动化的是"筛选和起草"，不是"发表"。所有对外内容都经过人工审核闸门。

## 它能做什么

| 模块 | 命令 | 说明 |
|---|---|---|
| 雷达扫描 | `node src/radar.mjs scan` | 扫描 `config/targets.json` 里所有目标账号的最新帖，按互动速度打分入队 |
| 关键词发现 | `node src/discover.mjs` | 主动搜索 X 最新帖（关键词在 `config/config.json`），突破固定名单 |
| 机会队列 | `node src/radar.mjs report` | 查看当前高分机会 |
| 批量起草 | `node src/autoreply.mjs --prepare all` | LLM 按你的人设+随机风格卡起草回复（状态 pending-auto，**不发**） |
| 审核看板 | `node src/server.mjs` | 本地网页（默认 http://localhost:7788）：编辑/重写/拒绝/发送 |
| 定向起草 | `node src/draft.mjs <帖子URL>` | 为单条帖子起草 |
| 发送队列 | `node src/autoreply.mjs --send` | 发送所有 `pending-auto` 草稿，随机间隔拟人 |
| 引用/转推 | `node src/amplify.mjs --quote-draft <url>` / `--rt <url>` | 引用语起草后发送；转推直接执行 |
| 点赞+关注 | `node src/engage.mjs --auto` | 按日限额自动点赞、关注（带简介相关性闸） |

## 快速开始

```bash
# 0. 要求：Node 18+，本机装有 Chrome
bash setup.sh        # 启动自动化专用 Chrome（独立配置目录）+ 装依赖

# 1. 在弹出的 Chrome 窗口里登录：
#    - x.com（必须）
#    - 起草 LLM：yuanbao.tencent.com（默认）或 grok.com/x.com（二选一，见 config.json 的 llm 字段）

# 2. 写你的人设：config/persona.json（最重要的一步，决定草稿质量）
#    换目标账号：config/targets.json；调预算/间隔/关键词：config/config.json

# 3. 日常循环
node src/discover.mjs          # 刷新机会池
node src/radar.mjs scan        # 扫描目标账号
node src/autoreply.mjs --prepare all   # 起草（只起草，不发送！）
#    ↓ 此时打开 data/drafts.json 逐条审查：改写不顺手的，status 改 rejected 淘汰不要的
node src/server.mjs            # 或用看板审阅，更直观
node src/autoreply.mjs --send  # 人工把关之后，才发送
node src/engage.mjs --auto     # 点赞/关注按日限额自动跑
```

## 架构

```
目标库(targets.json) + 关键词发现流
        ↓
雷达扫描(radar) ──打分：互动速度 = (赞+3×评)/时长 × 新鲜度──→ 机会队列 opportunities.json
        ↓
LLM 起草(llm→元宝/Grok 网页版) ──人设(persona.json) + 风格卡随机 + 反AI腔规则──→ drafts.json (pending-auto)
        ↓
人工质量闸（看板 server.mjs / 直接改 drafts.json）
        ↓
拟人发送(x-send) ──随机间隔、先读后动、顺手点赞──→ 状态 sent
        ↓
数据回流 data/*.json（粉丝快照 metrics.json、互动明细 engagement.json、限流体检 from:me）
```

## 核心设计

1. **CDP 接管真 Chrome**：登录态/指纹全真。Chrome 136+ 禁止默认配置目录开调试端口，所以用独立 `--user-data-dir`（`setup.sh` 已处理）
2. **网页版 LLM 当起草引擎**：0 元 API 费。用「双标记法」从聊天页面干净抽取正文：提示词尾部埋 `（回复指令结束）`，要求模型答完输出 `[[END]]`，两头一夹就是正文。**每次提问必须点"新建对话"**——旧会话残留的结束标记会让完成判断误触发（最深的坑）
3. **打分看互动速度不看绝对值**：`(赞 + 3×评论) / 帖子年龄`，新鲜帖加成——小号蹭曝光靠的是抢前排
4. **风格卡随机化**：每条草稿随机抽一种结构（经验/跨域印证/提问/反调/短反应），批量发出去不像模板
5. **人工闸门**：`pending-auto → sent / rejected` 三态，拒绝理由落盘，反哺提示词

## 风控红线（务必读）

- ❌ 不做私信（冷 DM = 举报源头）
- ❌ 不做关注后取关（检测最狠的行为）
- ❌ 跳过正文以 @ 开头的帖子（子回复/对线串），赢了没收益输了结怨
- ❌ LLM 给的数字必须人工核对（模型会编"2015 年"这种细节）
- ✅ 额度爬坡：新号从 默认值（赞 30/关注 12/回复 15）起步，连续数日无异常再上调
- ✅ 所有发送动作默认走人工审核；`--send` 前请真的看一遍草稿
- ⚠️ 本项目操作你自己的账号，遵守平台条款的责任在使用者。X 对未授权自动化有明确的限制条款，请自行评估并控制好量级

## 目录结构

```
├── setup.sh              # 初始化：启动专用 Chrome + 装依赖
├── config/
│   ├── config.json       # 引擎选择/端口/预算/间隔/关键词
│   ├── persona.json      # 你的人设（回复规则、反AI腔、粗口尺度都在这）
│   └── targets.json      # 监控目标账号
├── src/
│   ├── bridge.mjs        # CDP 连接层（所有浏览器操作的地基）
│   ├── config.mjs        # 配置加载
│   ├── persona.mjs       # 人设 → 提示词构建
│   ├── llm.mjs           # LLM 统一适配（yuanbao/grok）
│   ├── yuanbao.mjs       # 腾讯元宝适配（含新建对话/双标记抽取）
│   ├── grok.mjs          # Grok 适配
│   ├── radar.mjs         # 目标扫描 + 打分
│   ├── discover.mjs      # 关键词发现流
│   ├── autoreply.mjs     # 批量起草 + 队列发送
│   ├── draft.mjs         # 单帖起草
│   ├── x-send.mjs        # 回复发送端（支持 dry-run）
│   ├── amplify.mjs       # 引用/转推
│   ├── engage.mjs        # 点赞/关注（日限额+相关性闸）
│   └── server.mjs        # 本地审核看板
└── data/                 # 运行时生成：机会队列/草稿/互动明细/指标
```

## 已知边界

- X 前端改版会导致 `data-testid` 选择器失效，需按报错更新对应文件
- 网页版 LLM 有各自的用量限制（Grok 免费额度较小，元宝相对宽裕），`config.json` 一键切换
- Windows 未测试，macOS 实测可用；Linux 把 setup.sh 里的启动命令换成你的 Chrome 路径即可
