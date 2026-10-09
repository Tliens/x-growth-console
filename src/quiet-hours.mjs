// 夜间静默窗口：21:00 – 次日 06:00 不执行任何对外动作（发帖/评论/关注/点赞）
// 夜间受众不在线，动作浪费且是典型机器人特征；回关等常驻循环睡过窗口，明早自动恢复
export function inQuietHours(d = new Date()) {
  const h = d.getHours();
  return h >= 21 || h < 6;
}

// 距离早上恢复（06:01）的毫秒数
export function msUntilMorning(d = new Date()) {
  const wake = new Date(d);
  if (d.getHours() >= 21) wake.setDate(wake.getDate() + 1);
  wake.setHours(6, 0 + Math.floor(Math.random() * 20) + 1, Math.floor(Math.random() * 60), 0);
  return Math.max(wake.getTime() - d.getTime(), 0);
}
