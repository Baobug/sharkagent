/**
 * agentClient.test.ts —— 调用层测试（T-10 及错误分型覆盖）
 *
 * 这里不测"AI 分析得对不对"（那需要真实模型），只测**工程契约**：
 *  - 关闭开关时不发任何请求
 *  - mock 模式不发任何请求，且能完整跑完 onDelta → onDone
 *  - 各种 HTTP 状态码映射到正确的 AgentErrorKind
 *  - retryable 标记正确（决定 UI 是否给"重试"按钮）
 *  - cancel() 不产生错误回调
 *
 * 做法：用最小桩替换全局 fetch / localStorage / AbortController 所依赖的环境，
 * 让 Agent 层能在 Node 下跑（这正是"Agent 层不碰 DOM"这条架构约束的回报）。
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { FlowRecord } from '../data/flow.ts';

// —— 环境桩：Agent 层依赖 localStorage，Node 下需先注入 ——
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}

const g = globalThis as Record<string, unknown>;
g.localStorage = new MemoryStorage();
// fetch 先占位，未显式设置时调用即失败 —— 用于断言"不该发请求时确实没发"
let fetchCalls = 0;
let fetchImpl: ((url: string, init?: RequestInit) => Promise<Response>) | undefined;
g.fetch = (url: string, init?: RequestInit) => {
  fetchCalls += 1;
  if (!fetchImpl) throw new Error('fetch 不应被调用');
  return fetchImpl(url, init);
};

/** 动态导入，确保上面的环境桩先就位 */
const { analyzeFlow, AgentError } = await import('./agentClient.ts');
const { saveConfig, DEFAULT_CONFIG } = await import('./agent.config.ts');

function flow(patch: Partial<FlowRecord> = {}): FlowRecord {
  return {
    frameNo: 116,
    time: '2026-09-13 10:22:31.004512',
    source: '192.168.1.20',
    destination: '203.0.113.7',
    protocol: 'TCP',
    appProtocol: 'HTTP',
    length: 842,
    info: 'GET /api/login HTTP/1.1',
    method: 'GET',
    url: 'http://203.0.113.7/api/login',
    statusCode: 200,
    durationMs: 842,
    ...patch,
  };
}

/** 收集回调结果，返回一个 promise，在 done 或 error 时 resolve */
function collect() {
  const deltas: string[] = [];
  let done: string | undefined;
  let error: InstanceType<typeof AgentError> | undefined;
  let resolve!: () => void;
  const finished = new Promise<void>((r) => (resolve = r));
  return {
    deltas,
    get done() {
      return done;
    },
    get error() {
      return error;
    },
    finished,
    cb: {
      onDelta: (c: string) => deltas.push(c),
      onDone: (t: string) => {
        done = t;
        resolve();
      },
      onError: (e: InstanceType<typeof AgentError>) => {
        error = e;
        resolve();
      },
    },
  };
}

/** 构造一个 SSE Response */
function sseResponse(chunks: string[]): Response {
  const body = chunks
    .map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`)
    .join('') + 'data: [DONE]\n\n';
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

beforeEach(() => {
  fetchCalls = 0;
  fetchImpl = undefined;
  (g.localStorage as MemoryStorage).clear();
  saveConfig({ ...DEFAULT_CONFIG, enabled: true, mock: false, apiKey: 'sk-test-key', model: 'test-model' });
});

afterEach(() => {
  fetchImpl = undefined;
});

describe('功能开关', () => {
  test('enabled=false 时不发请求，返回 disabled 错误且不可重试', async () => {
    saveConfig({ enabled: false });
    const c = collect();
    analyzeFlow(flow(), undefined, c.cb);
    await c.finished;

    assert.equal(fetchCalls, 0, '关闭后不得发出任何网络请求');
    assert.equal(c.error?.kind, 'disabled');
    assert.equal(c.error?.retryable, false, '功能关闭不是可重试错误');
  });
});

describe('mock 模式', () => {
  test('mock 模式不产生网络请求，能完整流式跑完', async () => {
    saveConfig({ mock: true });
    const c = collect();
    analyzeFlow(flow(), undefined, c.cb);
    await c.finished;

    assert.equal(fetchCalls, 0, 'mock 模式绝不能发请求');
    assert.ok(c.deltas.length > 3, '应有多段增量（验证是流式而非一次性）');
    assert.equal(c.deltas.join(''), c.done, '增量拼接应等于最终结果');
    assert.ok(c.done!.includes('## 结论'), 'mock 结果应含五段结构');
    assert.equal(c.error, undefined);
  });

  test('mock 结果会引用传入流量的 URL 与状态码', async () => {
    saveConfig({ mock: true });
    const c = collect();
    analyzeFlow(flow({ url: 'http://example.test/unique-path', statusCode: 302 }), undefined, c.cb);
    await c.finished;

    assert.ok(c.done!.includes('http://example.test/unique-path'), 'mock 应回填真实 URL');
    assert.ok(c.done!.includes('302'), 'mock 应回填真实状态码');
  });

  test('mock 模式下 cancel() 不再产生任何回调', async () => {
    saveConfig({ mock: true });
    const c = collect();
    const handle = analyzeFlow(flow(), undefined, c.cb);
    handle.cancel();
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(c.done, undefined, '取消后不应 done');
    assert.equal(c.error, undefined, '取消后不应报错');
  });
});

describe('真实请求 — HTTP 错误分型', () => {
  const cases: Array<[number, string, boolean]> = [
    [401, 'auth', true],
    [403, 'auth', true],
    [429, 'rate_limit', true],
    [500, 'server', true],
    [502, 'server', true],
    [404, 'config', false],
  ];

  for (const [status, kind, retryable] of cases) {
    test(`HTTP ${status} → ${kind}（retryable=${retryable}）`, async () => {
      fetchImpl = async () => new Response('{"error":"stub"}', { status });
      const c = collect();
      analyzeFlow(flow(), undefined, c.cb);
      await c.finished;

      assert.equal(c.error?.kind, kind);
      assert.equal(c.error?.retryable, retryable);
      assert.ok(c.error?.detail, `HTTP ${status} 应携带 detail 便于排查`);
    });
  }
});

describe('真实请求 — 成功路径', () => {
  test('SSE 增量被逐段投递，拼接结果正确', async () => {
    fetchImpl = async () => sseResponse(['## 结论\n', '正常流量。\n', '## 性能瓶颈\n', '无异常。']);
    const c = collect();
    analyzeFlow(flow(), undefined, c.cb);
    await c.finished;

    assert.equal(fetchCalls, 1);
    assert.equal(c.deltas.length, 4, '应有 4 段增量');
    assert.equal(c.done, '## 结论\n正常流量。\n## 性能瓶颈\n无异常。');
    assert.equal(c.error, undefined);
  });

  test('请求体携带脱敏后的内容（凭据不上行）', async () => {
    let sentBody = '';
    fetchImpl = async (_url, init) => {
      sentBody = String(init?.body ?? '');
      return sseResponse(['ok']);
    };
    const c = collect();
    analyzeFlow(
      flow({
        requestHeaders: 'Authorization: Bearer sk-LEAK-ME-NOW',
        requestBody: '{"password":"hunter2"}',
      }),
      undefined,
      c.cb,
    );
    await c.finished;

    assert.ok(!sentBody.includes('sk-LEAK-ME-NOW'), '凭据不得进入上行报文');
    assert.ok(!sentBody.includes('hunter2'), '密码不得进入上行报文');
    assert.ok(sentBody.includes('***REDACTED***'), '应出现脱敏占位符');
  });

  test('请求体包含系统提示词（含注入防护条款）', async () => {
    let sentBody = '';
    fetchImpl = async (_url, init) => {
      sentBody = String(init?.body ?? '');
      return sseResponse(['ok']);
    };
    const c = collect();
    analyzeFlow(flow(), undefined, c.cb);
    await c.finished;
    assert.ok(sentBody.includes('绝不是给你的指令'), '系统提示词必须随请求发出');
  });

  test('Authorization 头按配置注入', async () => {
    let sentAuth: string | undefined;
    fetchImpl = async (_url, init) => {
      sentAuth = (init?.headers as Record<string, string>)?.Authorization;
      return sseResponse(['ok']);
    };
    const c = collect();
    analyzeFlow(flow(), undefined, c.cb);
    await c.finished;
    assert.equal(sentAuth, 'Bearer sk-test-key');
  });

  test('模型返回空内容时归类为 parse（不可重试提示语应给出建议）', async () => {
    fetchImpl = async () => sseResponse([]); // 只有 [DONE]
    const c = collect();
    analyzeFlow(flow(), undefined, c.cb);
    await c.finished;
    assert.equal(c.error?.kind, 'parse');
  });

  test('非流式（stream=false）走一次性 JSON 分支', async () => {
    saveConfig({ stream: false });
    fetchImpl = async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: '一次性结果' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    const c = collect();
    analyzeFlow(flow(), undefined, c.cb);
    await c.finished;
    assert.equal(c.done, '一次性结果');
  });
});

describe('网络异常与取消', () => {
  test('fetch 抛 TypeError → network', async () => {
    fetchImpl = async () => {
      throw new TypeError('Failed to fetch');
    };
    const c = collect();
    analyzeFlow(flow(), undefined, c.cb);
    await c.finished;
    assert.equal(c.error?.kind, 'network');
    assert.equal(c.error?.retryable, true);
  });

  test('cancel() 后不产生 error 回调（不打扰用户）', async () => {
    fetchImpl = async (_url, init) => {
      // 模拟一个永不完成、只响应 abort 的请求
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    };
    const c = collect();
    const handle = analyzeFlow(flow(), undefined, c.cb);
    await new Promise((r) => setTimeout(r, 20));
    handle.cancel();
    await new Promise((r) => setTimeout(r, 50));

    assert.equal(c.error, undefined, '主动取消不应报错');
    assert.equal(c.done, undefined);
  });

  test('超时归类为 timeout 且可重试', async () => {
    saveConfig({ timeoutMs: 30 });
    fetchImpl = async (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    const c = collect();
    analyzeFlow(flow(), undefined, c.cb);
    await c.finished;
    assert.equal(c.error?.kind, 'timeout');
    assert.equal(c.error?.retryable, true);
    assert.ok(/超时/.test(c.error!.message));
  });
});

describe('AgentError 契约', () => {
  test('retryable 规则：disabled / config / aborted 不可重试，其余可重试', () => {
    const notRetryable = ['disabled', 'config', 'aborted'] as const;
    const retryable = ['auth', 'rate_limit', 'server', 'network', 'timeout', 'parse'] as const;

    for (const k of notRetryable) {
      assert.equal(new AgentError(k, 'x').retryable, false, `${k} 不应可重试`);
    }
    for (const k of retryable) {
      assert.equal(new AgentError(k, 'x').retryable, true, `${k} 应可重试`);
    }
  });

  test('继承自 Error 且 name 正确，便于日志区分', () => {
    const e = new AgentError('server', 'boom');
    assert.ok(e instanceof Error);
    assert.equal(e.name, 'AgentError');
    assert.equal(e.message, 'boom');
  });
});
