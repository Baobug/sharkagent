/**
 * useAgentAnalysis.ts —— 把 Agent 调用层接进 React 的中间 Hook
 *
 * 【作用】管理一次分析的状态机：idle -> connecting -> streaming -> done | error
 * 【解耦意义】UI 组件（AiAnalysisPanel）只认这里的接口。将来把分析逻辑从
 *             "前端直连模型" 换成 "Tauri 后端 Rust 内核" 时，只改本文件内部实现，
 *             组件层零改动。这也是 DESIGN.md 里"内核复用、外壳可换"的最小体现。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { analyzeFlow, AgentError, type AnalyzeHandle } from '../agent/agentClient.ts';
import type { FlowRecord } from '../data/flow.ts';

export type AnalysisStatus = 'idle' | 'connecting' | 'streaming' | 'done' | 'error';

export interface UseAgentAnalysis {
  text: string;
  status: AnalysisStatus;
  error: AgentError | null;
  copied: boolean;
  /** 从头开始分析当前流量 */
  start: () => void;
  /** 失败后原样重试（等价于重新发起） */
  retry: () => void;
  /** 中断进行中的请求 */
  cancel: () => void;
  /** 复制结果到剪贴板 */
  copy: () => void;
}

export function useAgentAnalysis(flow: FlowRecord | null, layers?: string[]): UseAgentAnalysis {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<AnalysisStatus>('idle');
  const [error, setError] = useState<AgentError | null>(null);
  const [copied, setCopied] = useState(false);

  const handleRef = useRef<AnalyzeHandle | null>(null);
  // 用 ref 保存最新入参，避免把 flow 写进 useCallback 依赖导致频繁重建
  const flowRef = useRef(flow);
  const layersRef = useRef(layers);
  flowRef.current = flow;
  layersRef.current = layers;

  const cancel = useCallback(() => {
    handleRef.current?.cancel();
    handleRef.current = null;
    setStatus((s) => (s === 'streaming' || s === 'connecting' ? 'idle' : s));
  }, []);

  const start = useCallback(() => {
    const f = flowRef.current;
    if (!f) return;

    // 先掐掉上一次请求，避免串台
    handleRef.current?.cancel();
    setText('');
    setError(null);
    setCopied(false);
    setStatus('connecting');

    handleRef.current = analyzeFlow(
      f,
      { layers: layersRef.current },
      {
        onDelta(chunk) {
          setStatus('streaming');
          setText((prev) => prev + chunk);
        },
        onDone(final) {
          setStatus('done');
          setText(final);
          handleRef.current = null;
        },
        onError(err) {
          setStatus('error');
          setError(err);
          handleRef.current = null;
        },
      },
    );
  }, []);

  const retry = useCallback(() => start(), [start]);

  const copy = useCallback(() => {
    if (!text) return;
    void navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      },
      () => {
        // 剪贴板不可用时降级：选中内容让用户手动复制
        const sel = window.getSelection();
        const range = document.createRange();
        const el = document.querySelector('.ai-markdown');
        if (el && sel) {
          range.selectNodeContents(el);
          sel.removeAllRanges();
          sel.addRange(range);
        }
      },
    );
  }, [text]);

  // 切换流量时重置状态；组件卸载时中断请求
  const frameNo = flow?.frameNo ?? null;
  useEffect(() => {
    return () => {
      handleRef.current?.cancel();
      handleRef.current = null;
    };
  }, [frameNo]);

  useEffect(() => {
    setText('');
    setError(null);
    setStatus('idle');
    setCopied(false);
  }, [frameNo]);

  return { text, status, error, copied, start, retry, cancel, copy };
}
