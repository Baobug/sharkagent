/**
 * redact.ts —— 敏感字段脱敏
 *
 * 【作用】在流量上下文送往模型之前，抹掉凭据类信息，避免密钥泄露到第三方模型服务。
 * 【设计】两条独立防线：
 *   1) 请求头/响应头按"字段名"精确脱敏（Authorization / Cookie / Set-Cookie / X-Api-Key ...）
 *   2) 请求体/响应体按"键名"与"常见凭据字面量"正则脱敏（password / token / id_card / 手机号 / 邮箱 ...）
 * 保留字段名与长度信息，让模型仍能判断"此处存在凭据且未加密传输"这一类安全问题。
 */

import type { FlowRecord } from '../data/flow.ts';

/** 需要整体替换的敏感请求头字段名（大小写不敏感） */
export const SENSITIVE_HEADERS: string[] = [
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'x-csrf-token',
  'x-xsrf-token',
  'api-key',
  'apikey',
  'access-token',
  'auth-token',
  'session',
  'x-session-id',
];

/** 需要脱敏的 JSON/表单键名（大小写不敏感，命中即整值替换） */
export const SENSITIVE_KEYS: string[] = [
  'password',
  'passwd',
  'pwd',
  'secret',
  'token',
  'access_token',
  'refresh_token',
  'id_token',
  'api_key',
  'apikey',
  'private_key',
  'credential',
  'authorization',
  'cookie',
  'sessionid',
  'session_id',
  'id_card',
  'idcard',
  'id_no',
  'cardno',
  'card_no',
  'bank_card',
  'phone',
  'mobile',
  'telephone',
  'email',
  'address',
  'ssn',
  'passport',
];

const MASK = '***REDACTED***';

/** 保留前 2 后 2 的弱脱敏，用于既能看出"有值"又不泄露内容（暂未启用，留作策略切换） */
export function weakMask(value: string): string {
  if (value.length <= 4) return MASK;
  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}

/**
 * 脱敏头部文本。
 * 输入形如 "Host: a.com\r\nAuthorization: Bearer xxx\r\n" 的原始头文本，
 * 输出同结构文本，敏感字段值被替换。
 */
export function redactHeaders(raw?: string): string | undefined {
  if (!raw) return raw;
  return raw
    .split(/\r?\n/)
    .map((line) => {
      const m = /^([^:]+):\s*(.*)$/.exec(line);
      if (!m) return line;
      const name = m[1].trim();
      if (SENSITIVE_HEADERS.includes(name.toLowerCase())) {
        return `${name}: ${MASK}`;
      }
      return line;
    })
    .join('\n');
}

// 内联 JSON 值： "password": "xxx" 或 password=xxx
const JSON_KV = /(["']?)([A-Za-z_][A-Za-z0-9_\-]*)\1(\s*[:=]\s*)(["'])([^"']*)\4/g;
// 未加引号的表单取值： password=abc&token=def
const FORM_KV = /([A-Za-z_][A-Za-z0-9_\-]*)(=)([^&\s"']+)/g;

/**
 * 脱敏正文文本。
 * 同时对 JSON 键值对与 form 键值对做键名匹配；再兜底匹配常见凭据字面量。
 */
export function redactBody(raw?: string): string | undefined {
  if (!raw) return raw;
  let out = raw.replace(JSON_KV, (whole, _q1, key: string, sep: string, q: string) => {
    if (SENSITIVE_KEYS.includes(key.toLowerCase())) {
      return `"${key}"${sep}${q}${MASK}${q}`;
    }
    return whole;
  });
  out = out.replace(FORM_KV, (whole, key: string, sep: string) => {
    if (SENSITIVE_KEYS.includes(key.toLowerCase())) {
      return `${key}${sep}${MASK}`;
    }
    return whole;
  });
  // 兜底：常见密钥/令牌字面量（JWT、sk- 开头、Bearer 后随）
  // 注意 [A-Za-z0-9_\-] 必须允许连字符与下划线：真实密钥形如 sk-live-xxxx / sk-proj-xxxx，
  // 若只写 [A-Za-z0-9] 则 "live" 段只有 4 字符就撞上连字符，{8,} 不满足，整个正则静默失效。
  out = out.replace(/\bsk-[A-Za-z0-9_\-]{8,}\b/g, MASK);
  out = out.replace(/\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\b/g, MASK);
  out = out.replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, `Bearer ${MASK}`);
  // 中国大陆手机号 / 18 位身份证
  out = out.replace(/\b1[3-9]\d{9}\b/g, MASK);
  out = out.replace(/\b\d{17}[\dXx]\b/g, MASK);
  return out;
}

/** 对整条流量做脱敏，返回新对象（不修改入参） */
export function redactFlow(flow: FlowRecord): FlowRecord {
  return {
    ...flow,
    requestHeaders: redactHeaders(flow.requestHeaders),
    responseHeaders: redactHeaders(flow.responseHeaders),
    requestBody: redactBody(flow.requestBody),
    responseBody: redactBody(flow.responseBody),
  };
}

/** 供 UI 提示：本次脱敏命中了哪些字段，让用户知道发生了什么 */
export function redactionHits(flow: FlowRecord): string[] {
  const hits: string[] = [];
  const src = flow as unknown as Record<string, string | undefined>;
  for (const key of ['requestHeaders', 'responseHeaders', 'requestBody', 'responseBody'] as const) {
    const orig = src[key];
    if (!orig) continue;
    const redacted = key.includes('eaders') ? redactHeaders(orig) : redactBody(orig);
    if (redacted !== orig) hits.push(key);
  }
  return hits;
}
