/**
 * FlowDetail.tsx —— 流量详情区（右键菜单入口之二）
 *
 * 【作用】展示当前条目的协议分层与字段，并支持在详情区右键直接发起 AI 分析。
 * 【对应需求 1】"在流量列表或流量详情区域支持鼠标右键" —— 两个区域都接入了同一个菜单项，
 *               详情区右键固定分析"当前正在查看"的这条流量。
 */

import { useContextMenuWithRender } from './ContextMenu.tsx';
import type { FlowRecord } from '../data/flow.ts';
import { layersForFlow } from '../data/sampleFlows.ts';

interface Props {
  flow: FlowRecord | null;
  onAnalyze: (frameNos: number[], source: 'current') => void;
  aiEnabled: boolean;
}

export function FlowDetail({ flow, onAnalyze, aiEnabled }: Props) {
  const ctx = useContextMenuWithRender();

  if (!flow) {
    return <div className="detail detail--empty">未选中流量。在列表中选择一条以查看详情。</div>;
  }

  const layers = layersForFlow(flow);

  /** 详情区右键菜单 */
  const openMenu = (e: React.MouseEvent) => {
    ctx.openFromEvent(e, [
      { id: 'copy-layer', label: '复制协议分层', onSelect: () => void navigator.clipboard.writeText(layers.join('\n')) },
      { id: 'sep', label: '', separatorBefore: true, onSelect: () => {} },
      {
        id: 'ai-current',
        label: `AI 分析当前流量（帧 #${flow.frameNo}）`,
        disabled: !aiEnabled,
        onSelect: () => onAnalyze([flow.frameNo], 'current'),
      },
    ]);
  };

  return (
    <>
      <div className="detail" onContextMenu={(e) => e.preventDefault()}>
        <div className="detail__tree" onContextMenu={openMenu}>
          <div className="detail__heading">协议分层</div>
          {layers.map((l, i) => (
            <div key={i} className="detail__layer" style={{ paddingLeft: 10 + i * 16 }}>
              ▸ {l}
            </div>
          ))}
        </div>

        <div className="detail__fields" onContextMenu={openMenu}>
          <div className="detail__heading">关键字段</div>
          <dl>
            {flow.method && (
              <>
                <dt>请求方法</dt>
                <dd>{flow.method}</dd>
              </>
            )}
            {flow.url && (
              <>
                <dt>URL</dt>
                <dd className="wrap">{flow.url}</dd>
              </>
            )}
            {flow.statusCode !== undefined && (
              <>
                <dt>状态码</dt>
                <dd>{flow.statusCode}</dd>
              </>
            )}
            {flow.durationMs !== undefined && (
              <>
                <dt>耗时</dt>
                <dd>{flow.durationMs} ms</dd>
              </>
            )}
            <dt>包长度</dt>
            <dd>{flow.length} 字节</dd>
            {flow.responseBody && (
              <>
                <dt>响应体大小</dt>
                <dd>{flow.responseBody.length} 字节</dd>
              </>
            )}
          </dl>
        </div>

        {/* 十六进制转储区（截图右下的 Byte view 位置） */}
        <div className="detail__hex" onContextMenu={openMenu}>
          <div className="detail__heading">字节视图</div>
          <pre>{hexPreview(flow)}</pre>
        </div>
      </div>
      {ctx.node}
    </>
  );
}

/** 生成伪十六进制预览（真实场景由 tshark -x 或 sharkd 提供） */
function hexPreview(flow: FlowRecord): string {
  const seed = `${flow.method ?? ''}${flow.url ?? ''}${flow.info}`;
  const bytes = Array.from(seed.slice(0, 48)).map((c) => c.charCodeAt(0) & 0xff);
  const pad = (n: number) => n.toString(16).padStart(2, '0');
  const lines: string[] = [];
  for (let i = 0; i < bytes.length; i += 16) {
    const chunk = bytes.slice(i, i + 16);
    const off = (i).toString(16).padStart(4, '0');
    const hex = chunk.map(pad).join(' ').padEnd(47, ' ');
    const ascii = chunk.map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
    lines.push(`${off}  ${hex}  ${ascii}`);
  }
  return lines.join('\n');
}
