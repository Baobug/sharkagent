# 更新日志

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added

#### M0 — 前端外壳 + AI 接入层（已完成）

- **右键入口**：流量列表与流量详情区均支持右键，菜单提供「AI 分析选中项（N 条）」「AI 分析（含协议栈详情）」「复制摘要」；无选中时自动回落到当前查看的条目。
- **配置层** `src/agent/agent.config.ts`：接口地址 / 模型名 / API Key / 超时 / 温度 / 流式开关 / 演示模式 / 上下文上限共 10 项，三级优先级 `DEFAULT_CONFIG ← .env ← localStorage`。
- **调用层** `src/agent/agentClient.ts`：OpenAI 兼容 `/chat/completions`，SSE 流式解析，`AgentError` 九类错误分型（`disabled`/`config`/`auth`/`rate_limit`/`server`/`network`/`timeout`/`aborted`/`parse`）并带 `retryable` 标记；零 React / DOM 依赖。
- **提示词层** `src/agent/prompts.ts`：系统提示词含 6 条约束（含提示注入防护）；上下文按头 70% / 尾 30% 截断。
- **脱敏层** `src/agent/redact.ts`：头部 15 个敏感字段名 + 正文 30 个敏感键名 + 凭据字面量正则（`sk-` / JWT / Bearer / 手机号 / 身份证）。
- **UI 层**：`AiAnalysisPanel`（流式 caret、复制 / 重新分析 / 停止 / 重试、错误卡）、`AgentSettings`（10 项可视化配置）、`useContextMenu`（通用右键菜单 Hook，含边缘避让）、`useAgentAnalysis`（`idle→connecting→streaming→done|error` 状态机）。
- **样本数据** `src/data/sampleFlows.ts`：3 条演示流量（明文 HTTP 带 token、TLS 握手、慢响应大包）。
- **文档**：`README.md`、`DEVELOPMENT_PLAN.md`、`DESIGN.md`（上层）。
- **开源合规文件**：`LICENSE`(Apache-2.0)、`CONTRIBUTING.md`、`SECURITY.md`、`CODE_OF_CONDUCT.md`、`TRADEMARKS.md`。

### Security

- 流量正文与响应体一律视为不可信数据，系统提示词显式声明其非指令属性，防提示注入。
- 默认演示模式，未显式关闭前不发网络请求。

## 计划中（未发布）

#### M1 — 真实 pcap 接入
- 引入 Tauri v2 + Rust 后端
- 子进程调用 `tshark` 解析 pcap，输出映射到 `FlowRecord`
- 端到端：打开 pcap → 列表 → 右键 → AI 分析

#### M2 — 结果聚合增强
- 多条流量的聚合摘要层，防 token 爆炸

#### M3 — MCP 外壳
- 复用同一 Agent 内核，暴露 MCP server 供外部客户端调用

---

## 版本号约定

- `0.x.y`：M0~M3 阶段，接口可能破坏性变更
- `1.0.0`：首发稳定版（桌面 GUI 或 MCP，见 `DEVELOPMENT_PLAN.md` 待确认项 ⑤）
