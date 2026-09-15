/**
 * agent.config.ts —— AI Agent 能力配置
 *
 * 【作用】把 Agent 的所有外部依赖收敛到一处，页面业务代码不感知任何接口细节。
 * 【替换】换模型/换网关只改这里，或改运行时配置（见 loadConfig/配置面板）。
 * 【关闭】把 enabled 设为 false，右键菜单里的 "AI 分析" 会置灰且不发送任何请求。
 *
 * 注意：apiKey 默认留空，绝不写入代码库。落地时按下面三种方式之一注入：
 *   1. 浏览器/WebView 开发者控制台执行：
 *        localStorage.setItem('sharkagent.ai.config', JSON.stringify({apiKey:'sk-xxx'}))
 *   2. 工程根目录建 `.env.local`（已 gitignore）：
 *        VITE_AI_API_KEY=sk-xxx
 *   3. 界面上点"设置"按钮填写（存入 localStorage）
 */

/** 运行时配置在 localStorage 中的键名（与代码解耦，便于改前缀） */
export const CONFIG_STORAGE_KEY = 'sharkagent.ai.config';

/** 可持久化的配置字段（不含非序列化内容） */
export interface AgentConfig {
  /** 总开关：false 时 AI 分析功能完全关闭，不发任何网络请求 */
  enabled: boolean;

  /** OpenAI 兼容协议的接口地址（base url，不含 /chat/completions） */
  baseUrl: string;

  /** 模型名称，例：deepseek-chat / glm-4-plus / qwen-plus / gpt-4o-mini */
  model: string;

  /** 鉴权信息（Bearer Token），留空则由后端网关自行鉴权 */
  apiKey: string;

  /** 可选：自定义附加请求头（例如某些网关需要 X-App-Id） */
  extraHeaders: Record<string, string>;

  /** 单次请求超时（毫秒）。超时会中断并给出明确提示 + 重试入口 */
  timeoutMs: number;

  /** 采样温度，分析型任务建议低温度 */
  temperature: number;

  /** 是否要求模型返回流式增量（侧边栏逐字渲染） */
  stream: boolean;

  /**
   * mock 模式：不请求真实模型，本地回放模拟分析结果。
   * 用于在没有 API key / 无网络的演示与联调场景。
   */
  mock: boolean;

  /** 发送给模型的上下文上限（字符数），超出会被截断，防止 token 爆炸 */
  maxContextChars: number;
}

/** 出厂默认值 —— 与页面逻辑无关，可自由替换 */
export const DEFAULT_CONFIG: AgentConfig = {
  enabled: true,
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  apiKey: '',
  extraHeaders: {},
  timeoutMs: 60_000,
  temperature: 0.2,
  stream: true,
  mock: true, // 默认开启 mock，保证无 key 也能直接看效果
  maxContextChars: 24_000,
};

/** .env 注入（构建期），优先级低于用户运行时配置 */
function envConfig(): Partial<AgentConfig> {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env ?? {};
  const out: Partial<AgentConfig> = {};
  if (env.VITE_AI_BASE_URL) out.baseUrl = env.VITE_AI_BASE_URL;
  if (env.VITE_AI_MODEL) out.model = env.VITE_AI_MODEL;
  if (env.VITE_AI_API_KEY) out.apiKey = env.VITE_AI_API_KEY;
  if (env.VITE_AI_MOCK === 'false') out.mock = false;
  return out;
}

/** 读取持久化配置（localStorage），字段做类型校验，坏数据回退默认值 */
function persistedConfig(): Partial<AgentConfig> {
  try {
    const raw = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const out: Partial<AgentConfig> = {};
    if (typeof obj.enabled === 'boolean') out.enabled = obj.enabled;
    if (typeof obj.baseUrl === 'string') out.baseUrl = obj.baseUrl;
    if (typeof obj.model === 'string') out.model = obj.model;
    if (typeof obj.apiKey === 'string') out.apiKey = obj.apiKey;
    if (obj.extraHeaders && typeof obj.extraHeaders === 'object') {
      out.extraHeaders = obj.extraHeaders as Record<string, string>;
    }
    if (typeof obj.timeoutMs === 'number') out.timeoutMs = obj.timeoutMs;
    if (typeof obj.temperature === 'number') out.temperature = obj.temperature;
    if (typeof obj.stream === 'boolean') out.stream = obj.stream;
    if (typeof obj.mock === 'boolean') out.mock = obj.mock;
    if (typeof obj.maxContextChars === 'number') out.maxContextChars = obj.maxContextChars;
    return out;
  } catch {
    return {};
  }
}

/** 当前生效配置（内存缓存，避免每次请求都读 localStorage） */
let current: AgentConfig | null = null;

/** 获取生效配置：默认值 <- env <- 用户持久化 */
export function loadConfig(): AgentConfig {
  if (!current) {
    current = { ...DEFAULT_CONFIG, ...envConfig(), ...persistedConfig() };
  }
  return current;
}

/** 更新配置并持久化（设置面板调用）；传空字符串不会覆盖 apiKey 以外的默认值 */
export function saveConfig(patch: Partial<AgentConfig>): AgentConfig {
  current = { ...loadConfig(), ...patch };
  const { apiKey: _ak, ...rest } = current;
  void _ak;
  // apiKey 一并持久化（localStorage 是本机存储；如需更高安全性可换成 Tauri keyring）
  localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify({ ...rest, apiKey: current.apiKey }));
  return current;
}

/** 判断当前配置是否足以发起真实请求 */
export function canCallRealModel(cfg: AgentConfig = loadConfig()): boolean {
  return cfg.enabled && !cfg.mock && !!cfg.baseUrl && !!cfg.model;
}

/** 拼接 chat completions 端点，容错 baseUrl 结尾斜杠 */
export function chatCompletionsUrl(cfg: AgentConfig = loadConfig()): string {
  return `${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`;
}
