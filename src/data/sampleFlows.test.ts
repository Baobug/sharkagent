/**
 * sampleFlows.test.ts —— 演示数据的"禁止真实资产"守卫测试
 *
 * 【为什么需要这个测试】
 * sampleFlows.ts 会随开源仓库公开分发。一旦有人在调试时顺手粘一条真实抓包进去，
 * 真实服务器 IP / 内部用户名 / 手机号就会永久留在公开 git 历史里 —— 删掉也没用，
 * 历史里还在。这类事故靠"提交前记得检查"是防不住的，必须由自动化拦住。
 *
 * 【规则来源】见 RFC 5737（文档用 IP 段）与 RFC 2606（保留域名）。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE_FLOWS, layersForFlow } from './sampleFlows.ts';

/** 把一条流量所有字符串字段摊平成一个大字符串，便于整体扫描 */
function flatten(flow: (typeof SAMPLE_FLOWS)[number]): string {
  const parts: string[] = [];
  for (const value of Object.values(flow)) {
    if (typeof value === 'string') parts.push(value);
    else if (typeof value === 'number') parts.push(String(value));
  }
  return parts.join('\n');
}

const ALL_TEXT = SAMPLE_FLOWS.map(flatten).join('\n');

describe('演示数据 — 不含真实资产（公开仓库红线）', () => {
  test('所有 IP 必须属于 RFC 5737 文档段或 RFC 1918 私有段', () => {
    const ips = [...ALL_TEXT.matchAll(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/g)].map((m) => m[1]);
    assert.ok(ips.length > 0, '样本里应当有 IP，否则说明数据结构变了');

    const OK = [
      /^192\.0\.2\./, // RFC 5737 TEST-NET-1
      /^198\.51\.100\./, // RFC 5737 TEST-NET-2
      /^203\.0\.113\./, // RFC 5737 TEST-NET-3
      /^10\./, // RFC 1918
      /^192\.168\./, // RFC 1918
      /^172\.(1[6-9]|2\d|3[01])\./, // RFC 1918
    ];
    for (const ip of new Set(ips)) {
      assert.ok(
        OK.some((re) => re.test(ip)),
        `发现非保留段 IP：${ip}。演示数据只能用 RFC 5737 / RFC 1918 地址，` +
          `否则可能泄露真实资产（如需新增，请改用 203.0.113.x 形式）`,
      );
    }
  });

  test('不得出现任何真实域名（只允许 example.com 等保留域名）', () => {
    const domains = [...ALL_TEXT.matchAll(/\b([a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+)\b/gi)]
      .map((m) => m[1].toLowerCase())
      // 排除协议版本号这类伪域名：tlsv1.3 / tls1.2 / http1.1 / ipv4 / socks5.0
      // 注意：数字在点之前（tlsv1.3 → 首段以数字结尾），不能用"末段是数字"来判
      .filter((d) => !/^(tls|ssl|http|ipv?|socks|dtls)[a-z0-9]*\.[0-9]+$/i.test(d))
      // 排除 JWT/令牌片段（本来就不是域名）
      .filter((d) => !/^eyj/i.test(d))
      // 排除文件扩展名
      .filter((d) => !/\.(zip|json|txt|png|js|css|html?|xml)$/.test(d))
      // 单段标签（无点）本来就不会进来；纯数字开头排除
      .filter((d) => !/^\d/.test(d));

    const ALLOWED = /(^|\.)(example\.(com|net|org)|localhost)$/;
    const SUSPECT = [...new Set(domains)].filter((d) => !ALLOWED.test(d));

    assert.deepEqual(
      SUSPECT,
      [],
      `发现疑似真实域名：${SUSPECT.join(', ')}。演示数据只允许 example.com/net/org`,
    );
  });

  test('不得出现疑似真实姓名的用户名', () => {
    // 允许的占位用户名白名单；任何像真人姓名缩写的都要拦下
    const ALLOWED_USERS = ['alice', 'bob', 'carol', 'dave', 'uid'];
    const users = [...ALL_TEXT.matchAll(/"username"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
    for (const u of users) {
      assert.ok(
        ALLOWED_USERS.includes(u.toLowerCase()),
        `用户名 "${u}" 不在占位白名单 ${ALLOWED_USERS.join('/')} 内，` +
          `可能泄露真实账号。请改用通用占位名`,
      );
    }
  });

  test('手机号与身份证必须是全 0 占位', () => {
    const phones = [...ALL_TEXT.matchAll(/"phone"\s*:\s*"(\d+)"/g)].map((m) => m[1]);
    const ids = [...ALL_TEXT.matchAll(/"id_card"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);

    for (const p of phones) {
      assert.match(p, /^(0+|1[3-9]0{9})$/, `手机号 "${p}" 形似真实号码，请用 0 占位`);
    }
    for (const i of ids) {
      assert.match(i, /^0+$/, `身份证 "${i}" 形似真实号码，请用全 0 占位`);
    }
  });

  test('凭据字面量必须是"一眼假"（含 EXAMPLE 标记）', () => {
    // sk- / JWT 允许保留形态（供 redact 回归），但必须含 EXAMPLE 字样
    const keys = [...ALL_TEXT.matchAll(/\bsk-[A-Za-z0-9_-]{8,}/g)].map((m) => m[0]);
    for (const k of keys) {
      assert.ok(
        /EXAMPLE|REDACTED|not-a-real/i.test(k),
        `密钥 "${k}" 缺少 EXAMPLE 标记，看起来像真 key，会被扫描器误报`,
      );
    }

    const jwts = [...ALL_TEXT.matchAll(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)].map(
      (m) => m[0],
    );
    for (const j of jwts) {
      assert.ok(
        /EXAMPLE|PLACEHOLDER|REDACTED/i.test(j),
        `JWT "${j.slice(0, 30)}..." 缺少占位标记`,
      );
    }
  });

  test('必须恰好 3 条样本，覆盖 安全 / 正常 / 性能 三类场景', () => {
    assert.equal(SAMPLE_FLOWS.length, 3);

    // 安全样本：明文 HTTP **且** URL 里带凭据参数（这才是"安全问题"的判定点，
    // 只看 http:// 会把普通 HTTP 下载也算进来）
    const securityRisk = SAMPLE_FLOWS.filter(
      (f) => f.url?.startsWith('http://') && /token=|password=|secret=/.test(f.url),
    );
    const tls = SAMPLE_FLOWS.filter((f) => f.appProtocol?.startsWith('TLS'));
    const slow = SAMPLE_FLOWS.filter((f) => (f.durationMs ?? 0) > 3000);

    assert.equal(securityRisk.length, 1, '应恰好 1 条"明文传输凭据"安全问题样本');
    assert.equal(tls.length, 1, '应恰好 1 条 TLS 正常样本');
    assert.equal(slow.length, 1, '应恰好 1 条慢响应性能样本');
  });

  test('每条样本都应能被 layersForFlow 处理而不抛异常', () => {
    for (const f of SAMPLE_FLOWS) {
      const layers = layersForFlow(f);
      assert.ok(Array.isArray(layers) && layers.length >= 3, `帧 ${f.frameNo} 的协议分层异常`);
      assert.ok(layers[0].includes(String(f.frameNo)), '首个分层应含帧号');
    }
  });
});
