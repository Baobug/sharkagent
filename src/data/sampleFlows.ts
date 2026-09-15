/**
 * sampleFlows.ts —— 演示用流量样例
 *
 * 【作用】在没有 tshark / 未导入 pcap 时，让列表页与 AI 分析链路可立即被验证。
 * 【替换】接入真实数据时，把 FlowList 的数据源换成本模块的 `useFlows()` 即可，
 *         其他组件一律只依赖 FlowRecord 结构。
 *
 * 这里刻意放了三种典型样本：明文 HTTP 带 token（安全）、正常 HTTPS API（正常）、
 * 慢响应大体积下载（性能），方便一眼看出 AI 分析的差异。
 *
 * ⚠️ 【铁律】本文件会随仓库公开分发，**任何字段都不得出现真实资产**：
 *   - IP 一律用 RFC 5737 文档保留段：`192.0.2.0/24`、`198.51.100.0/24`、`203.0.113.0/24`
 *   - 域名一律用 RFC 2606 保留域名：`example.com` / `example.net` / `example.org`
 *   - 凭据一律写成"一眼假"形式（`sk-live-EXAMPLE-...`），但要保留形态，
 *     以便 `redact.ts` 的 sk- 兜底正则仍有可回归的样本（见 BUG-01）
 *   - 手机号/身份证用全 0 占位
 * 该规则由 `src/data/sampleFlows.test.ts` 自动校验，违规会导致测试失败。
 */

import type { FlowRecord } from './flow.ts';

/** 第 116 帧：明文 HTTP 请求，URL 携带 token —— 典型安全问题样本 */
const frame116: FlowRecord = {
  frameNo: 116,
  time: '1.133199000',
  source: '192.168.1.20',
  destination: '203.0.113.45',
  protocol: 'TCP',
  appProtocol: 'HTTP',
  linkProtocol: 'Ethernet II',
  ethSrc: 'b8:8a:ec:88:5e:de',
  ethDst: '10:7b:ef:ce:83:0b',
  length: 1285,
  info: 'GET /api/v1/user/profile?token=sk-live-EXAMPLE-not-a-real-key&uid=10023 HTTP/1.1',
  method: 'GET',
  url: 'http://203.0.113.45/api/v1/user/profile?token=sk-live-EXAMPLE-not-a-real-key&uid=10023',
  statusCode: 200,
  durationMs: 842,
  requestHeaders: [
    'GET /api/v1/user/profile?token=sk-live-EXAMPLE-not-a-real-key&uid=10023 HTTP/1.1',
    'Host: 203.0.113.45',
    'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    'Accept: application/json, text/plain, */*',
    'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.EXAMPLE.PLACEHOLDER',
    'Cookie: sessionid=0000000000EXAMPLE; uid=10023',
    'Referer: http://203.0.113.45/dashboard',
  ].join('\n'),
  responseHeaders: [
    'HTTP/1.1 200 OK',
    'Server: nginx/1.24.0',
    'Content-Type: application/json; charset=utf-8',
    'Content-Length: 612',
    'Set-Cookie: sessionid=0000000000EXAMPLE; Path=/',
    'X-Powered-By: Express',
  ].join('\n'),
  responseBody:
    '{"code":0,"data":{"uid":10023,"username":"alice","phone":"00000000000","id_card":"000000000000000000"}}',
  bodyTruncated: false,
};

/** 第 111 帧：HTTPS 正常 API 调用 —— 正常样本 */
const frame111: FlowRecord = {
  frameNo: 111,
  time: '1.001880000',
  source: '192.168.1.20',
  destination: '198.51.100.77',
  protocol: 'TLSv1.3',
  appProtocol: 'TLSv1.3',
  linkProtocol: 'Ethernet II',
  ethSrc: 'b8:8a:ec:88:5e:de',
  ethDst: '10:7b:ef:ce:83:0b',
  length: 2661,
  info: 'Application Data, Application Data',
  durationMs: 96,
  requestHeaders: '(TLS 加密，载荷不可见)',
  responseHeaders: '(TLS 加密，载荷不可见)',
};

/** 第 131 帧：大体积慢响应 —— 性能样本 */
const frame131: FlowRecord = {
  frameNo: 131,
  time: '1.126101580',
  source: '192.168.1.20',
  destination: '198.51.100.77',
  protocol: 'TCP',
  appProtocol: 'HTTP',
  linkProtocol: 'Ethernet II',
  ethSrc: 'b8:8a:ec:88:5e:de',
  ethDst: '10:7b:ef:ce:83:0b',
  length: 2640,
  info: 'GET /download/pkg/full-installer.zip HTTP/1.1',
  method: 'GET',
  url: 'http://198.51.100.77/download/pkg/full-installer.zip',
  statusCode: 200,
  durationMs: 4821,
  requestHeaders: ['GET /download/pkg/full-installer.zip HTTP/1.1', 'Host: 198.51.100.77', 'Accept-Encoding: identity'].join('\n'),
  responseHeaders: [
    'HTTP/1.1 200 OK',
    'Content-Type: application/zip',
    'Content-Length: 73418752',
    'Cache-Control: no-store',
  ].join('\n'),
  responseBody: '(二进制内容，已省略)',
};

export const SAMPLE_FLOWS: FlowRecord[] = [frame116, frame111, frame131];

/** 详情区协议分层（对应截图下方的协议树） */
export function layersForFlow(flow: FlowRecord): string[] {
  const base = [`Frame ${flow.frameNo}: ${flow.length} bytes on wire`, flow.linkProtocol ?? 'Ethernet II'];
  if (flow.protocol === 'TCP' || flow.protocol === 'UDP') {
    base.push(`Internet Protocol Version 4, Src: ${flow.source.split(':')[0]}, Dst: ${flow.destination.split(':')[0]}`);
    base.push(`Transmission Control Protocol, Src Port: ${flow.source.split(':')[1] ?? '-'}, Dst Port: ${flow.destination.split(':')[1] ?? '-'}`);
  }
  base.push(flow.appProtocol);
  return base;
}
