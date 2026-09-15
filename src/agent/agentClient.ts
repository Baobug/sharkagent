/**
 * agentClient.ts —— Agent 调用层（页面代码唯一需要接触的 AI 接口）
 *
 * 【作用】把"分析一条流量"封装成一个纯净的异步流式调用，UI 只消费事件回调和信号。
 * 【解耦】
 *   - 不 import 任何 React / DOM 组件，纯 TS 逻辑，可单测、可在 Tauri 后端替换为 Rust 实现。
 *   - 接口地址 / 模型名 / 鉴权 / 超时 / 开关 全部来自 agent.config.ts。
 *   - 换 provider（DeepSeek / GLM / Kimi / ollama / 自建网关）无需改动本文件之外的任何代码。
 * 【能力】
 *   - SSE 流式增量（OpenAI 兼容 chat/completions）
 *   - 超时中断 + AbortController 取消
 *   - 结构化错误分类（配置 / 鉴权 / 限流 / 服务端 / 网络 / 超时），便于 UI 给明确提示
 *   - mock 模式：无 key 也能演示
 */

import {
  type AgentConfig,
  chatCompletionsUrl,
  loadConfig,
} from './agent.config.ts';
import { SYSTEM_PROMPT, buildUserMessage, truncateContext, type FlowDetailContext } from './prompts.ts';
import { redactFlow } from './redact.ts';
import type { FlowRecord } from '../data/flow.ts';

/** 分析过程回调 */
export interface AnalyzeCallbacks {
  /** 收到一段增量文本 */
  onDelta?(chunk: string): void;
  /** 成功结束，text 为完整结果 */
  onDone?(text: string): void;
  /** 失败，err 已分类，可直接展示 */
  onError?(err: AgentError): void;
}

/** 取消句柄 */
export interface AnalyzeHandle {
  cancel(): void;
}

/** 错误类别 —— 决定 UI 提示文案与是否提供重试 */
export type AgentErrorKind =
  | 'disabled'      // 功能被关闭
  | 'config'        // 配置缺失（地址/模型/密钥）
  | 'auth'          // 401 / 403
  | 'rate_limit'    // 429
  | 'server'        // 5xx
  | 'network'       // 断网 / CORS / DNS
  | 'timeout'       // 超时
  | 'aborted'       // 用户主动取消
  | 'parse';        // 响应格式异常

/** 统一错误对象 */
export class AgentError extends Error {
  kind: AgentErrorKind;
  /** 是否建议提供"重试"入口 */
  retryable: boolean;
  /** 附加细节（如 HTTP 状态码、原始报文片段） */
  detail?: string;

  constructor(kind: AgentErrorKind, message: string, detail?: string) {
    super(message);
    this.name = 'AgentError';
    this.kind = kind;
    this.detail = detail;
    this.retryable = kind !== 'disabled' && kind !== 'config' && kind !== 'aborted';
  }
}

/** 把任意异常归类 */
function classify(err: unknown, cfg: AgentConfig): AgentError {
  if (err instanceof AgentError) return err;
  if (err instanceof DOMException && err.name === 'AbortError') {
    return new AgentError('aborted', '分析已取消');
  }
  if (err instanceof TypeError) {
    // fetch 在网络层失败时抛 TypeError
    return new AgentError('network', '网络不可达或请求被拦截', String(err.message ?? err));
  }
  if (cfg.mock === false && !cfg.apiKey) {
    return new AgentError('config', '未配置 API Key，请先在设置中填写');
  }
  return new AgentError('network', '请求失败', String((err as Error)?.message ?? err));
}

/** 读取 SSE 行中的内容增量 */
function extractDelta(json: unknown): string {
  const obj = json as {
    choices?: Array<{ delta?: { content?: string | null }; message?: { content?: string } }>;
  };
  const choice = obj?.choices?.[0];
  if (!choice) return '';
  return choice.delta?.content ?? choice.message?.content ?? '';
}

/**
 * 发起一次流量分析（流式）。
 * @param flow   要分析的流量（内部会自动脱敏，调用方无需先处理）
 * @param detail 详情区上下文（协议分层等）
 * @param cb     过程回调
 */
export function analyzeFlow(
  flow: FlowRecord,
  detail?: FlowDetailContext,
  cb: AnalyzeCallbacks = {},
): AnalyzeHandle {
  const cfg = loadConfig();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const abort = (err: AgentError) => {
    if (timer) clearTimeout(timer);
    cb.onError?.(err);
  };

  // —— 前置校验：功能开关与配置完整性
  if (!cfg.enabled) {
    queueMicrotask(() => abort(new AgentError('disabled', 'AI 分析功能已关闭', '可在设置中重新开启')));
    return { cancel: () => {} };
  }

  // —— 安全：先脱敏，再组装上下文
  const safeFlow = redactFlow(flow);
  const userMessage = truncateContext(buildUserMessage(safeFlow, detail), cfg.maxContextChars);

  // —— mock 模式：本地回放，不产生任何网络请求
  if (cfg.mock) {
    return runMock(userMessage, cb);
  }

  if (!cfg.model) {
    queueMicrotask(() => abort(new AgentError('config', '未配置模型名称')));
    return { cancel: () => {} };
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
    ...cfg.extraHeaders,
  };

  const body = JSON.stringify({
    model: cfg.model,
    stream: cfg.stream,
    temperature: cfg.temperature,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ],
  });

  void (async () => {
    let acc = '';
    try {
      timer = setTimeout(() => {
        controller.abort();
        abort(new AgentError('timeout', `分析超时（${cfg.timeoutMs / 1000}s）`, '可重试，或改用更快的模型/更小的上下文'));
      }, cfg.timeoutMs);

      const resp = await fetch(chatCompletionsUrl(cfg), {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw httpError(resp.status, text);
      }

      if (!cfg.stream || !resp.body) {
        const json = await resp.json();
        acc = extractDelta(json);
        if (timer) clearTimeout(timer);
        cb.onDelta?.(acc);
        cb.onDone?.(acc);
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE 以空行分隔事件
        const parts = buffer.split(/\r?\n\r?\n/);
        buffer = parts.pop() ?? '';
        for (const part of parts) {
          for (const line of part.split(/\r?\n/)) {
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (payload === '[DONE]') continue;
            try {
              const chunk = extractDelta(JSON.parse(payload));
              if (chunk) {
                acc += chunk;
                cb.onDelta?.(chunk);
              }
            } catch {
              /* 单行解析失败不影响整体流 */
            }
          }
        }
      }

      if (timer) clearTimeout(timer);
      if (!acc) {
        cb.onError?.(new AgentError('parse', '模型返回了空结果', '可重试或检查模型名称是否正确'));
        return;
      }
      cb.onDone?.(acc);
    } catch (err) {
      if (timer) clearTimeout(timer);
      const e = classify(err, cfg);
      // 用户主动 cancel 不再打扰
      if (e.kind === 'aborted') return;
      cb.onError?.(e);
    }
  })();

  return {
    cancel() {
      if (timer) clearTimeout(timer);
      controller.abort();
    },
  };
}

/** HTTP 状态码 -> 分类错误 */
function httpError(status: number, bodyText: string): AgentError {
  const snippet = bodyText.slice(0, 300);
  if (status === 401 || status === 403) {
    return new AgentError('auth', `鉴权失败（HTTP ${status}）`, snippet || '请检查 API Key 是否有权限');
  }
  if (status === 429) {
    return new AgentError('rate_limit', '触发限流（HTTP 429）', snippet || '请稍后重试或提升配额');
  }
  if (status >= 500) {
    return new AgentError('server', `模型服务异常（HTTP ${status}）`, snippet || '服务端错误，稍后重试');
  }
  if (status === 404) {
    return new AgentError('config', '接口地址或模型名称不正确（HTTP 404）', snippet || '请检查 baseUrl 与 model');
  }
  return new AgentError('server', `请求被拒绝（HTTP ${status}）`, snippet);
}

/**
 * mock 实现：按行逐步吐出一段模拟分析，形态与真实流一致。
 * 目的：无 API key / 无网络 / 演示场景下也能完整走通 UI 链路。
 */
function runMock(userMessage: string, cb: AnalyzeCallbacks): AnalyzeHandle {
  const pickedUrl = /- \*\*URL\*\*：(.+)/.exec(userMessage)?.[1] ?? '—';
  const pickedStatus = /- \*\*状态码\*\*：(\d+)/.exec(userMessage)?.[1] ?? '—';
  const isPlainHttp = pickedUrl.startsWith('http://');

  const text = `## 结论
该流量**可疑（中风险）**：请求以明文 HTTP 传输且 URL 中携带凭据参数，同时在 ${pickedStatus} 响应中发现性能可疑点。

## 异常与安全风险
- **风险等级**：中
- **问题描述**：请求使用明文 ${isPlainHttp ? 'HTTP' : '协议'}，URL ${pickedUrl} 中疑似包含可复用的身份参数，一旦被中间人截获即可重放登录态。
- **证据**：上下文"请求头（已脱敏）"中出现 \`Authorization: ***REDACTED***\`，说明该请求携带了凭据；若同时缺少 \`Secure\`/\`HttpOnly\` 标志则风险升级。
- **问题描述**：未发现 CSRF Token 字段。
- **证据**：请求头中无 \`X-CSRF-Token\` 类字段。

## 性能瓶颈
- **是否异常**：是（轻度）
- **分析**：状态码 ${pickedStatus}，若为 3xx 且伴随多次重定向，会额外增加 1~2 个 RTT；若为 200 但响应体过大，需检查是否缺少压缩。
- **证据**：请对照"响应头"中的 \`Content-Encoding\` 与 \`Content-Length\`。

## 排查与修复建议
1. 全站强制 HTTPS 并开启 HSTS：\`Strict-Transport-Security: max-age=31536000; includeSubDomains\`。
2. 凭据改为放在请求体或 \`Authorization\` 头中，避免出现在 URL（URL 会进日志、Referer、浏览器历史）。
3. Cookie 补全 \`Secure; HttpOnly; SameSite=Lax\`。
4. 若存在重定向链，收敛为一次 301，并核对 \`Content-Encoding: gzip/br\` 是否生效。

## 建议的后续动作
- 过滤同会话流量：\`tcp.stream eq <你的流号>\`
- 检查明文 HTTP：\`http.request.method == "POST" && tcp.port == 80\`
- 导出该流会话：\`tshark -r input.pcap -q -z follow,tcp,ascii,0\`
`;

  let i = 0;
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const tick = () => {
    if (cancelled) return;
    // 每帧吐 6~14 个字符，模拟真实流式节奏
    const step = 6 + Math.floor(Math.random() * 8);
    const chunk = text.slice(i, i + step);
    i += step;
    if (chunk) cb.onDelta?.(chunk);
    if (i >= text.length) {
      cb.onDone?.(text);
      return;
    }
    timer = setTimeout(tick, 18);
  };
  timer = setTimeout(tick, 120);

  return {
    cancel() {
      cancelled = true;
      if (timer) clearTimeout(timer);
    },
  };
}
