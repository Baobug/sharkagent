/**
 * App.tsx —— 应用外壳（三栏布局，对应 DESIGN.md 3 节）
 *
 * 【作用】只做三件事：
 *   1. 持有全局状态：流量列表、当前帧、多选集合
 *   2. 把「AI 分析」请求路由到侧边栏（这是需求 1 的编排层）
 *   3. 挂载设置面板，管理功能开关
 * 【关键设计】AI 能力的接入点集中在本文件的 handleAnalyze 一处。
 *             若将来要关闭该功能，只需把 aiEnabled 置 false / 移除侧边栏挂载，
 *             列表与详情区本身完全不受影响 —— 满足"保证现有页面功能不受影响"。
 */

import { useCallback, useMemo, useState } from 'react';
import { PacketList } from './components/PacketList.tsx';
import { FlowDetail } from './components/FlowDetail.tsx';
import { AiAnalysisPanel } from './components/AiAnalysisPanel.tsx';
import { AgentSettings } from './components/AgentSettings.tsx';
import { SAMPLE_FLOWS, layersForFlow } from './data/sampleFlows.ts';
import { loadConfig, type AgentConfig } from './agent/agent.config.ts';
import type { FlowRecord } from './data/flow.ts';

export default function App() {
  const flows = SAMPLE_FLOWS;

  const [currentFrameNo, setCurrentFrameNo] = useState<number | null>(116);
  const [selectedFrameNos, setSelectedFrameNos] = useState<number[]>([116]);
  /** 侧边栏要分析的流量（需求 1 的最终目标） */
  const [analysisTarget, setAnalysisTarget] = useState<FlowRecord | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [cfg, setCfg] = useState<AgentConfig>(() => loadConfig());

  /** 当前正在查看的流量对象 */
  const currentFlow = useMemo(
    () => flows.find((f) => f.frameNo === currentFrameNo) ?? null,
    [flows, currentFrameNo],
  );

  /** 列表行点击：普通点击单选，Ctrl 切换，Shift 追加 */
  const handleRowClick = useCallback(
    (frameNo: number, e: { ctrlKey: boolean; shiftKey: boolean }) => {
      setCurrentFrameNo(frameNo);
      setSelectedFrameNos((prev) => {
        if (e.ctrlKey) {
          return prev.includes(frameNo) ? prev.filter((n) => n !== frameNo) : [...prev, frameNo];
        }
        if (e.shiftKey && prev.length > 0) {
          const all = flows.map((f) => f.frameNo);
          const from = all.indexOf(prev[prev.length - 1]);
          const to = all.indexOf(frameNo);
          const [lo, hi] = from < to ? [from, to] : [to, from];
          return all.slice(lo, hi + 1);
        }
        return [frameNo];
      });
    },
    [flows],
  );

  /**
   * 右键菜单「AI 分析」的统一落点。
   * 需求 1：有选中则分析选中项，否则分析当前条目。
   * 这里取第一帧作为侧边栏主分析对象；多选时在侧边栏顶部展示数量提示。
   */
  const handleAnalyze = useCallback(
    (frameNos: number[], source: 'selection' | 'current') => {
      const targetNo = frameNos[0] ?? currentFrameNo;
      const target = flows.find((f) => f.frameNo === targetNo) ?? null;
      if (!target) return;
      // 同步选中态与当前态，避免"分析的和看到的不一致"
      setCurrentFrameNo(target.frameNo);
      if (source === 'current') setSelectedFrameNos([target.frameNo]);
      setAnalysisTarget({ ...target });
    },
    [flows, currentFrameNo],
  );

  const aiEnabled = cfg.enabled;

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__brand">
          <span className="logo">🦈</span>
          <span>SharkAgent</span>
          <span className="topbar__sub">AI 流量分析</span>
        </div>
        <div className="topbar__right">
          <span className={`chip ${aiEnabled ? 'chip--on' : 'chip--off'}`}>
            AI {aiEnabled ? '已启用' : '已关闭'}
            {aiEnabled && cfg.mock ? ' · 演示模式' : ''}
          </span>
          <button type="button" className="btn" onClick={() => setSettingsOpen(true)}>
            设置
          </button>
        </div>
      </header>

      <main className={`workspace${analysisTarget ? ' has-panel' : ''}`}>
        <div className="workspace__left">
          <PacketList
            flows={flows}
            currentFrameNo={currentFrameNo}
            selectedFrameNos={selectedFrameNos}
            onRowClick={handleRowClick}
            onAnalyze={handleAnalyze}
            aiEnabled={aiEnabled}
          />
          <FlowDetail flow={currentFlow} onAnalyze={handleAnalyze} aiEnabled={aiEnabled} />
        </div>

        {/* AI 侧边栏：分析目标为 null 时不渲染，保证默认布局与原来一致 */}
        {analysisTarget && (
          <AiAnalysisPanel
            flow={analysisTarget}
            layers={layersForFlow(analysisTarget)}
            onClose={() => setAnalysisTarget(null)}
          />
        )}
      </main>

      <AgentSettings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={(next) => setCfg(next)}
      />
    </div>
  );
}
