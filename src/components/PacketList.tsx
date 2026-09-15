/**
 * PacketList.tsx —— 流量列表（右键菜单入口之一）
 *
 * 【作用】渲染流量表格，并在鼠标右键时弹出菜单，其中含「AI 分析」项。
 * 【第 1 条需求的落地点】
 *   - 有选中行或多选 -> 分析选中项（本组件把选中集抛给 onAnalyzeFrames）
 *   - 无选中（右键点在空白/未选中行）-> 分析"当前正在查看"的那一条（currentFrameNo）
 * 【解耦】组件不直接调用 Agent；只通过回调把"要分析哪些帧"交给上层，
 *         由上层决定交给 AI 还是做别的（复制、导出、标记…）。
 */

import { useContextMenuWithRender } from './ContextMenu.tsx';
import type { FlowRecord } from '../data/flow.ts';

interface Props {
  flows: FlowRecord[];
  /** 当前正在查看的帧号（详情区显示的条目） */
  currentFrameNo: number | null;
  /** 用户多选的行（帧号集合） */
  selectedFrameNos: number[];
  onRowClick: (frameNo: number, e: { ctrlKey: boolean; shiftKey: boolean }) => void;
  /** 右键菜单选择「AI 分析」时触发，交给上层 */
  onAnalyze: (frameNos: number[], source: 'selection' | 'current') => void;
  /** 功能是否可用（配置关闭时置灰菜单项） */
  aiEnabled: boolean;
}

export function PacketList({
  flows,
  currentFrameNo,
  selectedFrameNos,
  onRowClick,
  onAnalyze,
  aiEnabled,
}: Props) {
  const ctx = useContextMenuWithRender();

  return (
    <>
      <div className="pk-list" onContextMenu={(e) => e.preventDefault()}>
        <table className="pk-table">
          <thead>
            <tr>
              <th className="col-no">No.</th>
              <th className="col-time">Time</th>
              <th className="col-addr">Source</th>
              <th className="col-addr">Destination</th>
              <th className="col-proto">Protocol</th>
              <th className="col-len">Length</th>
              <th>Info</th>
            </tr>
          </thead>
          <tbody>
            {flows.map((f) => {
              const isCurrent = f.frameNo === currentFrameNo;
              const isSelected = selectedFrameNos.includes(f.frameNo);
              return (
                <tr
                  key={f.frameNo}
                  className={`pk-row${isCurrent ? ' is-current' : ''}${isSelected ? ' is-selected' : ''}`}
                  onClick={(e) =>
                    onRowClick(f.frameNo, { ctrlKey: e.ctrlKey || e.metaKey, shiftKey: e.shiftKey })
                  }
                  onContextMenu={(e) => {
                    // 右键未选中行时，按需求 1：若已有选中项则分析选中项，
                    // 否则分析"当前正在查看"的条目 —— 这里把决策信息一并传给菜单，
                    // 由菜单项回调按下标组合出最终目标集合。
                    const hasSelection = selectedFrameNos.length > 0;
                    const targets = hasSelection ? selectedFrameNos : currentFrameNo != null ? [currentFrameNo] : [f.frameNo];
                    const source: 'selection' | 'current' = hasSelection ? 'selection' : 'current';

                    ctx.openFromEvent(e, [
                      {
                        id: 'copy',
                        label: '复制摘要',
                        onSelect: () => {
                          void navigator.clipboard.writeText(
                            `${f.frameNo}\t${f.time}\t${f.source}\t${f.destination}\t${f.protocol}\t${f.length}\t${f.info}`,
                          );
                        },
                      },
                      { id: 'sep1', label: '', separatorBefore: true, onSelect: () => {} },
                      {
                        id: 'ai',
                        label: `AI 分析${
                          source === 'selection'
                            ? `选中项（${targets.length} 条）`
                            : `当前流量（帧 #${targets[0]}）`
                        }`,
                        disabled: !aiEnabled,
                        onSelect: () => onAnalyze(targets, source),
                      },
                      {
                        id: 'ai-detail',
                        label: 'AI 分析（含协议栈详情）',
                        disabled: !aiEnabled,
                        onSelect: () => onAnalyze(targets, source),
                      },
                    ]);
                  }}
                >
                  <td className="col-no">{f.frameNo}</td>
                  <td className="col-time">{f.time}</td>
                  <td className="col-addr">{f.source}</td>
                  <td className="col-addr">{f.destination}</td>
                  <td className="col-proto">{f.appProtocol || f.protocol}</td>
                  <td className="col-len">{f.length}</td>
                  <td className="col-info">{f.info}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!aiEnabled && <div className="pk-notice">AI 分析功能当前已关闭（可在右上角设置中开启）</div>}
      </div>
      {ctx.node}
    </>
  );
}
