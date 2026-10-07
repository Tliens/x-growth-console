#!/usr/bin/env bash
# 一键初始化：启动自动化专用 Chrome + 安装依赖
set -e
cd "$(dirname "$0")"

echo "==> 1/2 启动自动化专用 Chrome（独立配置目录，与你日常用的 Chrome 并存）"
CHROME_DIR="$HOME/.x-growth-console/chrome-profile"
mkdir -p "$CHROME_DIR"
if curl -s --max-time 2 http://localhost:9222/json/version > /dev/null 2>&1; then
  echo "    端口 9222 已有 Chrome 在跑，跳过启动"
else
  if [[ "$(uname)" == "Darwin" ]]; then
    open -na "Google Chrome" --args --remote-debugging-port=9222 \
      --user-data-dir="$CHROME_DIR" --no-first-run --no-default-browser-check
  else
    google-chrome --remote-debugging-port=9222 \
      --user-data-dir="$CHROME_DIR" --no-first-run --no-default-browser-check &
  fi
  sleep 4
fi

echo "==> 2/2 安装依赖"
[ -d node_modules ] || npm install --no-fund --no-audit

echo ""
echo "✅ 初始化完成。接下来："
echo "   1. 在刚弹出的 Chrome 窗口里登录 X（以及你选的起草 LLM：元宝 yuanbao.tencent.com 或 Grok）"
echo "   2. 把 config/persona.json 改成你的人设，config/targets.json 换成你领域的目标账号"
echo "   3. node src/radar.mjs scan   # 扫描机会"
echo "   4. node src/server.mjs       # 打开审核看板 http://localhost:7788"
