/**
 * AgentSettings.tsx —— Agent 配置面板
 *
 * 【作用】让用户在不改代码的前提下替换接口地址 / 模型名 / 鉴权信息，或一键关闭功能。
 * 【价值】这是"接入方式解耦"对用户可见的那一面：所有配置项集中在此，
 *         保存后写入 localStorage，下一次请求立即生效。
 * 【安全】API Key 只存本机 localStorage，不上传、不写进仓库。
 *         如需更高安全性，可替换为 Tauri 的 keyring（见 DESIGN.md 4.4）。
 */

import { useEffect, useState } from 'react';
import { loadConfig, saveConfig, DEFAULT_CONFIG, type AgentConfig } from '../agent/agent.config.ts';

interface Props {
  open: boolean;
  onClose: () => void;
  /** 保存后通知外层刷新（右键菜单的禁用态等） */
  onSaved: (cfg: AgentConfig) => void;
}

export function AgentSettings({ open, onClose, onSaved }: Props) {
  const [draft, setDraft] = useState<AgentConfig>(() => loadConfig());

  useEffect(() => {
    if (open) setDraft(loadConfig());
  }, [open]);

  if (!open) return null;

  const set = <K extends keyof AgentConfig>(key: K, value: AgentConfig[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const handleSave = () => {
    const saved = saveConfig(draft);
    onSaved(saved);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="AI Agent 设置">
        <header className="modal__head">
          <h2>AI Agent 设置</h2>
          <button type="button" className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </header>

        <div className="modal__body">
          <label className="field field--switch">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) => set('enabled', e.target.checked)}
            />
            <span>
              <b>启用 AI 分析</b>
              <small>关闭后右键菜单中的「AI 分析」将置灰，且不发出任何网络请求。</small>
            </span>
          </label>

          <label className="field field--switch">
            <input type="checkbox" checked={draft.mock} onChange={(e) => set('mock', e.target.checked)} />
            <span>
              <b>演示模式（Mock）</b>
              <small>本地回放分析结果，不请求真实模型。适合无密钥时预览效果。</small>
            </span>
          </label>

          <label className="field">
            <span>接口地址（OpenAI 兼容 base url）</span>
            <input
              type="text"
              value={draft.baseUrl}
              placeholder="https://api.deepseek.com/v1"
              onChange={(e) => set('baseUrl', e.target.value)}
            />
            <small>兼容 DeepSeek / 智谱 / Kimi / 通义 / 自建网关 / 本地 ollama。</small>
          </label>

          <label className="field">
            <span>模型名称</span>
            <input
              type="text"
              value={draft.model}
              placeholder="deepseek-chat"
              onChange={(e) => set('model', e.target.value)}
            />
          </label>

          <label className="field">
            <span>鉴权信息（API Key）</span>
            <input
              type="password"
              value={draft.apiKey}
              placeholder="sk-..."
              onChange={(e) => set('apiKey', e.target.value)}
            />
            <small>仅保存在本机，不上传。留空则不带 Authorization 头。</small>
          </label>

          <div className="field-row">
            <label className="field">
              <span>超时（毫秒）</span>
              <input
                type="number"
                min={3000}
                step={1000}
                value={draft.timeoutMs}
                onChange={(e) => set('timeoutMs', Number(e.target.value) || DEFAULT_CONFIG.timeoutMs)}
              />
            </label>
            <label className="field">
              <span>温度</span>
              <input
                type="number"
                min={0}
                max={2}
                step={0.1}
                value={draft.temperature}
                onChange={(e) => set('temperature', Number(e.target.value))}
              />
            </label>
            <label className="field">
              <span>上下文上限（字符）</span>
              <input
                type="number"
                min={2000}
                step={1000}
                value={draft.maxContextChars}
                onChange={(e) => set('maxContextChars', Number(e.target.value) || DEFAULT_CONFIG.maxContextChars)}
              />
            </label>
          </div>

          <label className="field field--switch">
            <input type="checkbox" checked={draft.stream} onChange={(e) => set('stream', e.target.checked)} />
            <span>
              <b>流式输出</b>
              <small>关闭后改为一次性返回（部分网关不支持 SSE 时可关掉）。</small>
            </span>
          </label>

          <details className="field-advanced">
            <summary>附加请求头（JSON）</summary>
            <textarea
              rows={3}
              value={JSON.stringify(draft.extraHeaders, null, 2)}
              onChange={(e) => {
                try {
                  set('extraHeaders', JSON.parse(e.target.value || '{}'));
                } catch {
                  /* 输入过程中的非法 JSON 忽略，不阻断编辑 */
                }
              }}
            />
          </details>
        </div>

        <footer className="modal__foot">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => setDraft({ ...DEFAULT_CONFIG })}
          >
            恢复默认
          </button>
          <div className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn btn--primary" onClick={handleSave}>
            保存
          </button>
        </footer>
      </div>
    </div>
  );
}
