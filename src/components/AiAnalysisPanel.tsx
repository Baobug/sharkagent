/**
 * AiAnalysisPanel.tsx —— AI 分析侧边栏
 *
 * 【作用】以流式方式展示分析结果，并提供复制 / 重新分析 / 取消 / 重试入口。
 * 【职责边界】只负责"展示与交互"：
 *   - 不直接拼上下文、不直接调 fetch、不读配置细节
 *   - 通过 useAgentAnalysis（见 useAgentAnalysis.ts）拿到状态与动作
 *   这样替换模型、替换调用方式（前端直连 <-> Tauri 后端）都不需要改本文件。
 */

import { useEffect, useRef } from 'react';
import { useAgentAnalysis } from './useAgentAnalysis';
import type { FlowRecord } from '../data/flow';
import { redactionHits } from '../agent/redact';

interface Props {
  /** 被分析的流量；为 null 时侧边栏收起 */
  flow: FlowRecord | null;
  /** 详情区上下文（协议分层） */
  layers?: string[];
  /** 关闭侧边栏 */
  onClose: () => void;
}

export function AiAnalysisPanel({ flow, layers, onClose }: Props) {
  const { text, status, error, start, retry, cancel, copy, copied } = useAgentAnalysis(flow, layers);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // 流式输出时自动滚到底部（用户手动上翻则不打扰）
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || status !== 'streaming') return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [text, status]);

  if (!flow) return null;

  const hits = redactionHits(flow);
  const busy = status === 'streaming' || status === 'connecting';

  return (
    <aside className="ai-panel" aria-label="AI 分析结果">
      <header className="ai-panel__head">
        <div className="ai-panel__title">
          <span className="ai-dot" data-state={status} />
          <span>AI 流量分析</span>
          <span className="ai-panel__frame">帧 #{flow.frameNo}</span>
        </div>
        <button type="button" className="icon-btn" title="关闭" onClick={onClose}>
          ✕
        </button>
      </header>

      <div className="ai-panel__meta">
        {flow.method && <span className="tag">{flow.method}</span>}
        {flow.statusCode !== undefined && (
          <span className={`tag ${flow.statusCode >= 400 ? 'tag--bad' : 'tag--ok'}`}>{flow.statusCode}</span>
        )}
        {flow.durationMs !== undefined && <span className="tag">{flow.durationMs} ms</span>}
        <span className="tag">{flow.appProtocol}</span>
        {hits.length > 0 && (
          <span className="tag tag--warn" title={`已脱敏字段：${hits.join('、')}`}>
            已脱敏 {hits.length} 处
          </span>
        )}
      </div>

      {/* 错误态：明确提示 + 重试入口 */}
      {status === 'error' && error && (
        <div className="ai-error" role="alert">
          <div className="ai-error__title">
            {errorKindLabel(error.kind)} · 分析失败
          </div>
          <div className="ai-error__msg">{error.message}</div>
          {error.detail && <pre className="ai-error__detail">{error.detail}</pre>}
          <div className="ai-error__actions">
            {error.retryable && (
              <button type="button" className="btn btn--primary" onClick={retry}>
                重试
              </button>
            )}
            <button type="button" className="btn" onClick={() => start()}>
              重新分析
            </button>
          </div>
        </div>
      )}

      {/* 内容区 */}
      <div className="ai-panel__body" ref={bodyRef}>
        {status === 'idle' && (
          <div className="ai-empty">
            <p>点击「开始分析」将当前流量发送给 AI 研判。</p>
            <p className="ai-empty__hint">
              将自动携带：请求方法与 URL、请求/响应头、请求/响应体、状态码、耗时、响应大小。
              敏感字段（Authorization / Cookie / token / 手机号 / 身份证等）已脱敏。
            </p>
            <button type="button" className="btn btn--primary" onClick={() => start()}>
              开始分析
            </button>
          </div>
        )}

        {busy && !text && (
          <div className="ai-thinking">
            <span className="spinner" />
            {status === 'connecting' ? '正在连接模型…' : '正在分析…'}
          </div>
        )}

        {text && (
          <pre className="ai-markdown">
            {text}
            {status === 'streaming' && <span className="caret" />}
          </pre>
        )}
      </div>

      <footer className="ai-panel__foot">
        <button type="button" className="btn" disabled={!text} onClick={copy}>
          {copied ? '已复制 ✓' : '复制结果'}
        </button>
        <button type="button" className="btn" onClick={() => start()} disabled={busy}>
          重新分析
        </button>
        {busy ? (
          <button type="button" className="btn btn--ghost" onClick={cancel}>
            停止
          </button>
        ) : (
          <span className="ai-panel__hint">右键其他流量可继续分析</span>
        )}
      </footer>
    </aside>
  );
}

function errorKindLabel(kind: string): string {
  const map: Record<string, string> = {
    disabled: '功能已关闭',
    config: '配置问题',
    auth: '鉴权失败',
    rate_limit: '请求限流',
    server: '服务端错误',
    network: '网络异常',
    timeout: '请求超时',
    parse: '响应异常',
    aborted: '已取消',
  };
  return map[kind] ?? '未知错误';
}
