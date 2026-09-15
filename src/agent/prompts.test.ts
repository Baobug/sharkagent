/**
 * prompts.test.ts —— 提示词与上下文组装测试（T-07 ~ T-09）
 *
 * 重点：
 *  1. 上下文必须包含需求要求的全部字段（方法/URL/头/体/状态码/耗时/大小）
 *  2. 提示注入防护条款必须存在（漏掉这条 = 流量正文里的指令会被当命令执行）
 *  3. 截断函数必须真的截断，且保留头尾
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  SYSTEM_PROMPT,
  buildFlowContext,
  buildUserMessage,
  truncateContext,
} from './prompts.ts';
import type { FlowRecord } from '../data/flow.ts';

function flow(patch: Partial<FlowRecord> = {}): FlowRecord {
  return {
    frameNo: 116,
    time: '2026-09-13 10:22:31.004512',
    source: '192.168.1.20',
    destination: '203.0.113.7',
    protocol: 'TCP',
    appProtocol: 'HTTP',
    linkProtocol: 'Ethernet',
    length: 842,
    info: 'GET /api/login HTTP/1.1',
    ...patch,
  };
}

describe('SYSTEM_PROMPT — 约束条款完整性', () => {
  test('T-08 必须包含提示注入防护条款', () => {
    // 这条最容易在重构提示词时被顺手删掉，因此单独断言
    assert.ok(
      /视为待分析的|绝不是给你的指令/.test(SYSTEM_PROMPT),
      '缺少提示注入防护条款：模型会把流量正文里的指令当命令执行',
    );
  });

  test('必须要求引用具体证据、禁止编造', () => {
    assert.ok(/只基于给出的证据|禁止编造/.test(SYSTEM_PROMPT));
  });

  test('必须要求输出五段固定结构', () => {
    for (const section of ['## 结论', '## 异常与安全风险', '## 性能瓶颈', '## 排查与修复建议', '## 建议的后续动作']) {
      assert.ok(SYSTEM_PROMPT.includes(section), `缺少输出小节：${section}`);
    }
  });

  test('必须提示 REDACTED 含义，否则模型会误判为数据损坏', () => {
    assert.ok(SYSTEM_PROMPT.includes('***REDACTED***'));
  });
});

describe('buildFlowContext — 关键字段携带', () => {
  test('T-07 需求要求的字段全部出现在上下文中', () => {
    const ctx = buildFlowContext(
      flow({
        method: 'GET',
        url: 'http://203.0.113.7/api/login?token=***REDACTED***',
        statusCode: 200,
        durationMs: 842,
        requestHeaders: 'Host: 203.0.113.7',
        requestBody: '{"user":"alice"}',
        responseHeaders: 'Server: nginx',
        responseBody: '{"ok":true}',
      }),
    );

    assert.ok(ctx.includes('GET'), '缺少请求方法');
    assert.ok(ctx.includes('/api/login'), '缺少 URL');
    assert.ok(ctx.includes('200'), '缺少状态码');
    assert.ok(ctx.includes('842'), '缺少耗时');
    assert.ok(ctx.includes('Host: 203.0.113.7'), '缺少请求头');
    assert.ok(ctx.includes('"user":"alice"'), '缺少请求体');
    assert.ok(ctx.includes('Server: nginx'), '缺少响应头');
    assert.ok(ctx.includes('"ok":true'), '缺少响应体');
    assert.ok(ctx.includes('请求体大小') || ctx.includes('响应体大小'), '缺少响应大小');
  });

  test('无 HTTP 语义时（如纯 TLS 握手）不输出 HTTP 概要段', () => {
    const ctx = buildFlowContext(flow({ method: undefined, url: undefined, statusCode: undefined }));
    assert.ok(!ctx.includes('## HTTP 请求/响应概要'), 'TLS 流量不应出现 HTTP 段落');
    assert.ok(ctx.includes('## 流量基本信息'), '基础信息段应始终存在');
  });

  test('空字符串字段被跳过，不产生 "- **URL**：" 这类空条目', () => {
    const ctx = buildFlowContext(flow({ method: 'GET', url: '', statusCode: 200 }));
    assert.ok(!/- \*\*URL\*\*：\s*$/.test(ctx));
  });

  test('bodyTruncated 时给出截断提示', () => {
    const ctx = buildFlowContext(flow({ responseBody: 'partial...', bodyTruncated: true }));
    assert.ok(/已截断/.test(ctx));
  });

  test('detail.layers 被写入协议栈分层段', () => {
    const ctx = buildFlowContext(flow(), { layers: ['Frame 116', 'Ethernet II', 'TCP'] });
    assert.ok(ctx.includes('## 协议栈分层'));
    assert.ok(ctx.includes('Ethernet II'));
  });

  test('不传 detail 时不产生分层段，也不抛异常', () => {
    const ctx = buildFlowContext(flow());
    assert.ok(!ctx.includes('## 协议栈分层'));
  });

  test('buildUserMessage 保留原始问题与上下文', () => {
    const msg = buildUserMessage(flow({ url: 'http://x.com/a' }));
    assert.ok(msg.includes('请分析以下网络流量'));
    assert.ok(msg.includes('http://x.com/a'));
  });
});

describe('truncateContext — 上下文裁剪', () => {
  test('T-09 未超限时原样返回', () => {
    const s = 'a'.repeat(100);
    assert.equal(truncateContext(s, 200), s);
  });

  test('超限时结果长度受控，且保留头尾', () => {
    const head = 'HEAD_MARKER';
    const tail = 'TAIL_MARKER';
    const s = head + 'x'.repeat(5000) + tail;
    const out = truncateContext(s, 1000);

    assert.ok(out.length <= 1000 + 60, `实际长度 ${out.length} 应接近上限（含省略提示）`);
    assert.ok(out.startsWith(head), '头部应保留');
    assert.ok(out.endsWith(tail), '尾部应保留');
    assert.ok(out.includes('省略'), '应有省略提示');
  });

  test('省略提示中的字符数计算正确', () => {
    const s = 'a'.repeat(500);
    const out = truncateContext(s, 100);
    // 提示里应写"省略 400 字符"
    assert.ok(out.includes('省略 400 字符'), `实际输出：${out.slice(0, 200)}`);
  });

  test('恰好等于上限时不截断', () => {
    const s = 'a'.repeat(100);
    assert.equal(truncateContext(s, 100), s);
  });
});
