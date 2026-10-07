// LLM 统一适配：按 config.llm 选择起草引擎（yuanbao | grok）
// 两个引擎导出名不同，这里归一成 askLLM(ctx, question, marker, endMarker)
import { config } from './config.mjs';
import { askYuanbao } from './yuanbao.mjs';
import { askGrok } from './grok.mjs';

export function askLLM(ctx, question, marker = null, endMarker = null) {
  const fn = config.llm === 'grok' ? askGrok : askYuanbao;
  return fn(ctx, question, marker, endMarker);
}
