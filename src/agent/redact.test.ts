/**
 * redact.test.ts —— 脱敏层回归测试（T-01 ~ T-05）
 *
 * 运行：node --test --experimental-strip-types src/agent/redact.test.ts
 * 或（Node 22+ 原生支持 TS 剥离）：npm test
 *
 * 为什么这些用例必须存在：脱敏是"送往第三方模型"前的最后一道闸门。
 * 一旦回归（正则写错、字段名漏加），用户的凭据就会被静默发出，且没有任何报错。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  SENSITIVE_HEADERS,
  SENSITIVE_KEYS,
  redactHeaders,
  redactBody,
  redactFlow,
  redactionHits,
  weakMask,
} from './redact.ts';
import type { FlowRecord } from '../data/flow.ts';

const MASK = '***REDACTED***';

/** 构造一条最小流量，便于按需覆盖字段 */
function flow(patch: Partial<FlowRecord> = {}): FlowRecord {
  return {
    frameNo: 1,
    time: '2026-09-13 10:22:31.004512',
    source: '10.0.0.1',
    destination: '10.0.0.2',
    protocol: 'TCP',
    appProtocol: 'HTTP',
    length: 100,
    info: 'test',
    ...patch,
  };
}

describe('redactHeaders — 按字段名脱敏', () => {
  test('T-01 Authorization 值被替换，字段名保留', () => {
    const out = redactHeaders('Host: a.com\r\nAuthorization: Bearer sk-abcdef123456\r\n');
    assert.ok(!out!.includes('sk-abcdef123456'), '原始凭据不应残留');
    assert.ok(out!.includes('Authorization: ' + MASK), '字段名应保留，仅值被替换');
    assert.ok(out!.includes('Host: a.com'), '非敏感字段不应被改动');
  });

  test('T-02 字段名大小写不敏感', () => {
    for (const name of ['AUTHORIZATION', 'authorization', 'AuThOrIzAtIoN']) {
      const out = redactHeaders(`${name}: secret-value`);
      assert.equal(out, `${name}: ${MASK}`, `${name} 应被脱敏`);
    }
  });

  test('T-02b Cookie / Set-Cookie / X-Api-Key 均覆盖', () => {
    const raw = ['Cookie: sid=abc123', 'Set-Cookie: token=xyz', 'X-Api-Key: key-999'].join('\n');
    const out = redactHeaders(raw)!;
    assert.ok(!out.includes('abc123'));
    assert.ok(!out.includes('xyz'));
    assert.ok(!out.includes('key-999'));
    assert.equal(out.match(new RegExp(MASK.replace(/\*/g, '\\*'), 'g'))!.length, 3);
  });

  test('T-03 空值 / undefined 原样返回，不抛异常', () => {
    assert.equal(redactHeaders(undefined), undefined);
    assert.equal(redactHeaders(''), '');
  });

  test('T-03b 无冒号的行（如 HTTP 起始行、空行）保持原样', () => {
    const raw = 'GET /a HTTP/1.1\n\nHost: a.com';
    assert.equal(redactHeaders(raw), raw);
  });

  test('T-03c 值里含冒号时只按第一个冒号切分', () => {
    const out = redactHeaders('Authorization: Bearer a:b:c')!;
    assert.equal(out, `Authorization: ${MASK}`);
  });

  test('敏感头清单无大小写不一致的重复项', () => {
    const lower = SENSITIVE_HEADERS.map((h) => h.toLowerCase());
    assert.equal(new Set(lower).size, lower.length, '不应存在仅大小写不同的重复');
  });
});

describe('redactBody — 按键名与字面量脱敏', () => {
  test('T-04 JSON 键值对命中敏感键名', () => {
    const out = redactBody('{"user":"alice","password":"p@ssw0rd"}')!;
    assert.ok(!out.includes('p@ssw0rd'), '密码不应残留');
    assert.ok(out.includes('"user":"alice"') || out.includes('"user": "alice"'), '非敏感键应保留');
  });

  test('T-04b 表单格式命中敏感键名', () => {
    const out = redactBody('username=bob&token=abc123def&remember=1')!;
    assert.ok(!out.includes('abc123def'));
    assert.ok(out.includes('username=bob'));
    assert.ok(out.includes('remember=1'));
  });

  test('T-05 兜底：独立出现（无键名）的凭据字面量仍被抹掉', () => {
    const body = '{"note":"sk-live-abcdefgh12345678"}';
    const out = redactBody(body)!;
    assert.ok(!out.includes('sk-live-abcdefgh12345678'), 'sk- 字面量应被兜底清除');
  });

  test('T-05b JWT 三段的字面量被抹掉', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghijklmnop';
    assert.ok(!redactBody(`token=${jwt}`)!.includes(jwt));
    assert.ok(!redactBody(`{"x":"${jwt}"}`)!.includes(jwt));
  });

  test('T-05c Bearer 字面量被抹掉但保留 Bearer 前缀', () => {
    const out = redactBody('Authorization: Bearer abc.def-ghi_jkl')!;
    assert.ok(!out.includes('abc.def-ghi_jkl'));
    assert.ok(out.includes('Bearer'));
  });

  test('T-05d 中国大陆手机号与 18 位身份证被抹掉', () => {
    const out = redactBody('contact=13812345678&id=110101199003074512')!;
    assert.ok(!out.includes('13812345678'), '手机号应被抹掉');
    assert.ok(!out.includes('110101199003074512'), '身份证应被抹掉');
  });

  test('弱脱敏 weakMask 保留首尾但中间遮蔽', () => {
    assert.equal(weakMask('abcdefgh'), 'ab***gh');
    assert.equal(weakMask('abc'), MASK, '长度 ≤4 时整体遮蔽');
  });

  test('空值 / undefined 原样返回', () => {
    assert.equal(redactBody(undefined), undefined);
    assert.equal(redactBody(''), '');
  });

  test('敏感键清单无大小写不一致的重复项', () => {
    const lower = SENSITIVE_KEYS.map((k) => k.toLowerCase());
    assert.equal(new Set(lower).size, lower.length);
  });
});

describe('redactFlow — 整条流量脱敏', () => {
  test('四个正文/头部字段全部过一遍，其他字段不动', () => {
    const src = flow({
      frameNo: 116,
      method: 'GET',
      url: 'http://x.com/login?token=leakme',
      statusCode: 200,
      info: 'GET /login',
      requestHeaders: 'Authorization: Bearer leakme-credential',
      requestBody: '{"password":"hunter2"}',
      responseHeaders: 'Set-Cookie: sid=leakme-cookie',
      responseBody: '{"token":"leakme-token"}',
    });
    const out = redactFlow(src);

    assert.equal(out.frameNo, 116, '非内容字段应原样保留');
    assert.equal(out.url, src.url, 'URL 不在此层处理（见已知缺口 G-01）');
    assert.ok(!out.requestHeaders!.includes('leakme-credential'));
    assert.ok(!out.requestBody!.includes('hunter2'));
    assert.ok(!out.responseHeaders!.includes('leakme-cookie'));
    assert.ok(!out.responseBody!.includes('leakme-token'));
  });

  test('不修改入参（纯函数）', () => {
    const src = flow({ requestHeaders: 'Authorization: Bearer keepme' });
    const snapshot = src.requestHeaders;
    redactFlow(src);
    assert.equal(src.requestHeaders, snapshot, '原对象不应被改写');
  });

  test('redactionHits 只报告确实发生变化的字段', () => {
    const src = flow({
      requestHeaders: 'Host: a.com',
      requestBody: '{"password":"x"}',
      responseHeaders: 'Server: nginx',
    });
    assert.deepEqual(redactionHits(src).sort(), ['requestBody']);
  });

  test('无敏感内容时 redactionHits 为空数组', () => {
    const src = flow({ requestHeaders: 'Host: a.com', requestBody: '{"a":1}' });
    assert.deepEqual(redactionHits(src), []);
  });
});

describe('REGRESSION — 反向断言：确保上面测的是真脱敏而不是空实现', () => {
  test('T-06 若把脱敏函数换成恒等函数，T-01/T-04 的断言必须失败', () => {
    // 用恒等实现模拟"脱敏被误删"的回归场景
    const identity = (s?: string) => s;
    const headers = redactHeaders('Authorization: Bearer sk-real-secret')!;
    const body = redactBody('{"password":"p@ss"}')!;

    // 真实实现必须与恒等实现结果不同 —— 这正是本测试的意义
    assert.notEqual(headers, identity('Authorization: Bearer sk-real-secret'));
    assert.notEqual(body, identity('{"password":"p@ss"}'));

    // 且必须不含原文
    assert.ok(!headers.includes('sk-real-secret'));
    assert.ok(!body.includes('p@ss'));
  });
});
