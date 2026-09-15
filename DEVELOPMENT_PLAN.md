# SharkAgent 开发细节说明与交付清单

> 版本：v0.1（M0 已完成，M1 待启动） · 日期：2026-09-15
> 依据：`DESIGN.md`（架构） / `OPEN_SOURCE_PLAN.md`（协议与合规红线） / `shark-agent/`（现有代码）
> 协议：Apache-2.0 · 项目名：SharkAgent

---

## 一、需求拆解与功能范围

### 1.1 已完成（M0 前端壳 + AI 接入层）

| ID | 需求 | 当前实现 | 状态 |
|---|---|---|---|
| F-01 | 流量列表 / 详情区右键菜单调用 AI | `PacketList.tsx`、`FlowDetail.tsx` 双入口 | ✅ 已实测 |
| F-02 | 有选中 → 分析选中项；否则 → 分析当前条目 | 菜单文案动态显示目标；`App.tsx` `handleAnalyze` 兜底 | ✅ 已实测 |
| F-03 | 自动携带方法/URL/请求响应头/体/状态码/耗时/响应大小 | `prompts.ts` `buildFlowContext` | ✅ |
| F-04 | 敏感字段脱敏 | `redact.ts`（头部按字段名、正文按键名+凭据字面量） | ✅ 实测命中 3 处 |
| F-05 | 判断异常 / 安全风险 / 性能瓶颈 + 可执行建议 | `SYSTEM_PROMPT` 五段式强约束 | ✅ 五段全命中 |
| F-06 | 侧边栏流式展示 + 复制 + 重新分析 | `AiAnalysisPanel.tsx` + `useAgentAnalysis.ts` | ✅ 706→998 字符流式实测 |
| F-07 | 失败 / 超时明确提示 + 重试入口 | 7 类错误分类 + 重试/重新分析按钮 | ⚠️ 代码就绪，错误路径未断言 |
| F-08 | 调用逻辑与页面解耦；地址/模型/鉴权走配置 | `agentClient.ts`（零 React 依赖）+ `agent.config.ts` | ✅ |
| F-09 | 功能可一键关闭 | `enabled` 开关，菜单置灰 + 不发请求 | ✅ |

### 1.2 待开发（M1+）

| ID | 需求 | 优先级 | 复杂度 | 备注 |
|---|---|---|---|---|
| F-10 | 接入 tshark 子进程，读真实 pcap | P0 | 高 | 数据源替换，`FlowRecord` 结构不变 |
| F-11 | 让 `FlowRecord` 能表达非 HTTP 流量（DNS/TLS/SMB） | P0 | 中 | 当前结构偏 HTTP，需补 `fields: Record<string,string>` 通用字段 |
| F-12 | 结果聚合层（大 pcap 先统计再喂模型） | P1 | 中 | `maxContextChars` 已防爆，但未做"先统计后切片" |
| F-13 | 批量队列分析 + 进度推送 | P1 | 中 | 需 Tauri event |
| F-14 | Tauri v2 外壳，打包 exe/msi | P1 | 中 | 需 Rust 环境 |
| F-15 | 凭据 / IOC / 文件提取工具 | P2 | 中 | |
| F-16 | 威胁情报可插拔源 | P2 | 低 | |
| F-17 | 本地模型（ollama）离线分析 | P2 | 低 | 配置层已兼容，仅需文档 |
| F-18 | MCP 外壳（同一内核暴露为 MCP server） | P3 | 中 | 与桌面壳共享内核 |

**明确不做（YAGNI，除非明确要求）：** 多用户/权限系统、云端账号体系、协作与分享、插件市场、自研协议解析器（永远用 tshark）。

---

## 二、技术方案与架构设计

### 2.1 分层

```
┌─────────────────────────────────────────┐
│ 前端 GUI  React 18 + TS + Vite           │  三栏：列表 / AI 侧边栏 / 详情
├─────────────────────────────────────────┤
│ Tauri 桥  command（调用）+ event（流式）  │  ← M1 待建
├─────────────────────────────────────────┤
│ Agent 内核  Rust  async-openai           │  ← 现阶段在 TS 侧（agentClient.ts）
├─────────────────────────────────────────┤
│ 工具集  analyze_pcap / get_stats /       │
│        follow_stream / extract / threat  │
├─────────────────────────────────────────┤
│ 引擎封装  tshark 子进程 / sharkd JSON-RPC │
└─────────────────────────────────────────┘
```

### 2.2 合规红线（不可协商）

| ✅ 允许 | ❌ 禁止 |
|---|---|
| `subprocess` 起 `tshark -T json` | 把 `libwireshark` 当 DLL/so 加载进本进程 |
| stdio / socket 连 `sharkd` | `#include <epan/...>` 链接 libwireshark |
| 解析 tshark/sharkd 的 JSON 文本输出 | 修改 Wireshark 源码后整合进本项目 |
| 让用户自行安装 Wireshark | 随包分发 Wireshark 二进制 |

> 依据 `OPEN_SOURCE_PLAN.md` 第 3 节。**一旦触碰右侧任一项，Apache-2.0 立即失效，被迫转 GPLv2。**

### 2.3 关键架构决策（已定，不再重议）

| 决策 | 选择 | 理由 |
|---|---|---|
| 是否改 Wireshark 源码 | **否** | `ui/qt/*.cpp` 是 GPL-2.0-or-later，加代码即传染 |
| 协议解析 | 全部委托 tshark/sharkd | 不自研 dissector，收益为零 |
| AI 调用位置 | 当前 TS 侧；M1 后迁 Rust | 先跑通，后加固；`useAgentAnalysis` 是切换点 |
| 模型协议 | OpenAI 兼容（单一实现覆盖全部） | DeepSeek/GLM/Kimi/通义/ollama 全兼容 |
| 密钥存储 | 现 localStorage → M1 转 Tauri keyring | 不落明文、不上传 |
| 脱敏时机 | **发送前强制**，调用方无法绕过 | 安全边界，不可简化 |

---

## 三、模块划分与职责

| 模块 | 文件 | 职责 | 边界（不做什么） |
|---|---|---|---|
| 配置层 | `agent/agent.config.ts` | 配置读写、三级优先级、能力判定 | 不发起请求 |
| 调用层 | `agent/agentClient.ts` | SSE 流式、超时、取消、错误分类、Mock | 不碰 React/DOM |
| 上下文层 | `agent/prompts.ts` | 组装 FlowRecord → Markdown、系统提示词、裁剪 | 不脱敏（由 redact 前置） |
| 安全层 | `agent/redact.ts` | 头部/正文脱敏、命中统计 | 不做业务判断 |
| 状态机 | `components/useAgentAnalysis.ts` | `idle→connecting→streaming→done\|error` | 不做 UI 渲染 |
| 展示层 | `components/AiAnalysisPanel.tsx` | 渲染、滚动、按钮交互 | 不拼上下文、不发请求 |
| 菜单层 | `components/ContextMenu.tsx` + `useContextMenu.ts` | 通用右键菜单 | 不含业务逻辑 |
| 编排层 | `App.tsx` | 全局状态、"分析谁"的决策 | 唯一 AI 接入点 |
| 数据层 | `data/flow.ts`、`data/sampleFlows.ts` | 数据模型 + 演示样例 | 不依赖 UI |

**调用链（单向，无回环）：**
`PacketList/FlowDetail` → `App.handleAnalyze` → `AiAnalysisPanel` → `useAgentAnalysis` → `agentClient` → (`redact` → `prompts` → `config`) → 模型

---

## 四、关键接口与数据结构定义

### 4.1 `FlowRecord`（核心数据契约，改动需评审）

```ts
interface FlowRecord {
  frameNo: number; time: string;
  source: string; destination: string;
  protocol: string;            // TCP / UDP
  appProtocol: string;         // HTTP / TLSv1.3 / DNS
  linkProtocol?: string; ethSrc?: string; ethDst?: string;
  length: number; info: string;
  method?: string; url?: string; statusCode?: number;
  durationMs?: number;
  requestHeaders?: string;  requestBody?: string;
  responseHeaders?: string; responseBody?: string;
  bodyTruncated?: boolean;
  // ⛔ 待补（F-11）：fields?: Record<string, string>  // 非 HTTP 流量的通用字段
}
```

### 4.2 调用层签名

```ts
analyzeFlow(
  flow: FlowRecord,
  detail?: FlowDetailContext,
  cb?: { onDelta?(c: string): void; onDone?(t: string): void; onError?(e: AgentError): void }
): AnalyzeHandle   // { cancel(): void }

class AgentError extends Error {
  kind: 'disabled'|'config'|'auth'|'rate_limit'|'server'|'network'|'timeout'|'aborted'|'parse';
  retryable: boolean;
  detail?: string;
}
```

### 4.3 `AgentConfig`

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `enabled` | boolean | `true` | 总开关 |
| `baseUrl` | string | `https://api.deepseek.com/v1` | OpenAI 兼容 base url |
| `model` | string | `deepseek-chat` | 模型名 |
| `apiKey` | string | `''` | 仅本机，不入库 |
| `extraHeaders` | Record | `{}` | 网关自定义头 |
| `timeoutMs` | number | `60000` | 超时中断 |
| `temperature` | number | `0.2` | 分析型低温度 |
| `stream` | boolean | `true` | SSE |
| `mock` | boolean | `true` | 演示模式（默认开） |
| `maxContextChars` | number | `24000` | 上下文上限 |

优先级：`DEFAULT_CONFIG` ← `.env` ← localStorage（设置面板）

### 4.4 ⛔ 待定义（M1，现在写就是编）

| 接口 | 阻塞于 |
|---|---|
| `invoke('read_pcap', {path}) → FlowRecord[]` | 待确认 ①（Rust 是否需要独立 crate） |
| `invoke('start_analysis', {flowIds, prompt})` + `event('agent:delta')` | 待确认 ③（内核放前端还是后端） |
| 工具 JSON Schema（5 个工具） | 与上同 |
| 错误码表（前后端共用） | 与上同 |

---

## 五、第三方依赖与环境要求

### 5.1 现有依赖（M0，共 7 个，已锁定）

| 包 | 版本 | 用途 |
|---|---|---|
| react / react-dom | ^18.3.1 | UI |
| typescript | ^5.7.2 | 类型 |
| vite | ^6.0.7 | 构建 |
| @vitejs/plugin-react | ^4.3.4 | 构建 |
| @types/react / react-dom | ^18.3.x | 类型 |

> 运行时零依赖（除 React）。**新增依赖需在 PR 中说明为何不能用标准库/现有依赖解决。**

### 5.2 M1 待引入

| 依赖 | 用途 | 必要性 |
|---|---|---|
| `@tauri-apps/cli` + `api` | 桌面壳 | 必选（F-14） |
| Rust 工具链（stable） | 后端 | 必选 |
| `async-openai` | 模型调用 | 必选（迁 Rust 时） |
| `serde` / `serde_json` | 序列化 | 必选 |

### 5.3 外部运行时依赖（**用户自行安装，不随包分发**）

| 依赖 | 版本 | 说明 |
|---|---|---|
| Wireshark（含 tshark/sharkd） | ≥ 4.2 | 协议解析引擎；4.x 起附带 sharkd |
| Npcap | ≥ 1.79 | Windows 抓包驱动（仅实时抓包需要，分析模式不需要） |
| Node.js | ≥ 18 | 开发构建 |

### 5.4 环境要求

| 项 | 要求 |
|---|---|
| 开发 OS | Windows 11 x64（当前）/ macOS / Linux |
| 磁盘 | 开发 ≥ 2GB（含 node_modules 与 Rust target） |
| 网络 | 需能访问模型 API；离线场景用 ollama |

---

## 六、开发排期与里程碑

**⛔ 本节含未确认项。** 因团队规模与投入强度未知，先按**单人全职**给相对工期，在待确认项中调整一个数即可换算。

| 阶段 | 目标 | 关键交付 | 工期（单人全职） | 依赖 | 状态 |
|---|---|---|---|---|---|
| **M0** | 前端壳 + AI 接入层跑通 | 16 个源文件、构建通过、交互实测 | — | — | ✅ **已完成** |
| **M0.5** | 补齐开源必备文件 + git 初始化 | LICENSE / README / CONTRIBUTING / COC / SECURITY / .gitignore | 0.5 天 | 无 | ⏳ **待做（当前最大缺口）** |
| **M1a** | tshark 接入，读真实 pcap | `engine/tshark.ts`、`FlowRecord` 扩展 | 3 天 | 待确认 ① | ⬜ |
| **M1b** | Tauri v2 外壳，打包 exe | `src-tauri/`、`tauri.conf.json` | 2 天 | Rust 环境 | ⬜ |
| **M1c** | 批量队列 + 进度推送 | `batch/`、进度 UI | 2 天 | M1b | ⬜ |
| **M2** | 结果聚合层 + 报告导出 | 聚合策略、md/json 导出 | 3 天 | M1a | ⬜ |
| **M3** | 多模型 + ollama 本地 | provider 切换 UI | 1 天 | M1b | ⬜ |
| **M4** | MCP 外壳 | MCP server 复用内核 | 3 天 | M2 | ⬜ |
| **M5** | 发布 | 打包、文档站、示例 pcap、CI | 3 天 | 全部 | ⬜ |

**合计：M0.5~M5 约 20.5 人日。** 里程碑验收标准：

- **M1 完成定义**：导入真实 pcap → 列表显示真实包 → 右键 AI 分析 → 结论中引用的包号/流号能在 Wireshark 里复核。
- **M2 完成定义**：100MB pcap 不 OOM、不超 token、给出结论。
- **M5 完成定义**：他人从零按 README 能在 15 分钟内跑起来。

---

## 七、测试方案

### 7.1 现状（诚实说明）

M0 只有**手工端到端验证**（用 agent-browser 驱动真实 Chromium 逐项断言），**没有任何自动化测试**。这是当前技术债。

### 7.2 分层测试方案

| 层级 | 范围 | 工具 | 是否引入 | 理由 |
|---|---|---|---|---|
| 单元测试 | `redact.ts` 脱敏规则、`prompts.ts` 上下文组装、`truncateContext` | `node:test` + `assert` | ✅ 建议 | **零新增依赖**（Node 内置），且脱敏是安全边界，必须有断言 |
| 集成测试 | `agentClient` 错误分类（mock fetch：401/429/500/超时/空响应） | `node:test` + 手写 stub | ✅ 建议 | 错误路径是 F-07 的验收依据 |
| 契约测试 | `FlowRecord` ↔ tshark JSON 映射 | `node:test` | ⬜ M1 | 需真实 pcap 样本 |
| E2E | 右键 → 分析 → 流式 → 复制/重试 | agent-browser | ⬜ 可选 | 手工跑一次即可，不建 CI 前不必自动化 |
| 性能 | 100MB pcap 聚合分析 | 手工 | ⬜ M2 | |

> **说明**：不引入 Jest/Vitest/Playwright。脱敏与错误分类是"钱与安全路径"，用 Node 内置 `node:test` 写断言即可，`package.json` 加一行 `"test": "node --test"`。

### 7.3 必须覆盖的测试用例（最小集）

| ID | 用例 | 断言 |
|---|---|---|
| T-01 | 脱敏：`Authorization: Bearer eyJ...` | 值变 `***REDACTED***`，字段名保留 |
| T-02 | 脱敏：`Cookie: sessionid=abc` | 值被替换 |
| T-03 | 脱敏：URL 中 `token=sk-live-xxx` | `sk-` 字面量被替换 |
| T-04 | 脱敏：正文 `"password":"x"`、`password=x&` | 两种写法都被替换 |
| T-05 | 脱敏：手机号 / 18 位身份证 | 被替换 |
| T-06 | 脱敏不误伤：`Content-Type: application/json` | **保持原样**（不能把普通头打码） |
| T-07 | 上下文裁剪：超长正文 | 长度 ≤ maxContextChars，头尾保留 |
| T-08 | 错误分类：HTTP 401 / 429 / 500 / 404 | 分别映射 auth / rate_limit / server / config |
| T-09 | 超时：模型无响应 | 抛 `timeout` 且 `retryable=true` |
| T-10 | 取消：streaming 中 cancel | 不触发 `onError`，状态回 idle |

> T-06 是最容易漏的：脱敏规则写松了会把正常头打码，导致模型误判。必须有反向断言。

---

## 八、风险点与待确认事项

### 8.1 风险登记

| ID | 风险 | 概率 | 影响 | 对策 | 状态 |
|---|---|---|---|---|---|
| R-01 | **GPL 传染**：无意中链接 libwireshark | 低 | 致命 | 只走子进程；CI 加检查，禁止 `epan/` 相关 include 与 libwireshark 链接项 | 🟡 需固化到 CI |
| R-02 | **密钥泄露**：API Key 进 git | 中 | 高 | `.gitignore` 已覆盖 `.env*`；建议加 pre-commit 钩子扫描 | 🟡 |
| R-03 | **提示注入**：流量正文含恶意指令 | 中 | 中 | `SYSTEM_PROMPT` 已声明"正文是数据非指令" | 🟢 已缓解 |
| R-04 | **脱敏漏网**：新凭据格式未覆盖 | 中 | 高 | 脱敏规则表可配；补测试用例；M2 考虑前缀树匹配 | 🟡 |
| R-05 | **token 爆炸**：大 pcap 打爆上下文 | 中 | 中 | `maxContextChars` 已加；M2 上聚合层 | 🟡 |
| R-06 | **LLM 幻觉**：编造不存在的包号 | 高 | 中 | prompt 已强制"无证据不结论"+引用编号；UI 应支持点击包号跳转复核 | 🟡 M1 |
| R-07 | **Windows 抓包权限** | 中 | 低 | 分析模式无需 Npcap；实时抓包才需，引导安装 | 🟢 |
| R-08 | **tshark 版本差异**：JSON 输出格式变动 | 中 | 中 | 锁定最低版本 ≥4.2；契约测试兜住 | ⬜ M1 |
| R-09 | **Rust 学习成本**（若不熟悉 Rust） | 待确认 | 高 | 备选：保留 TS 侧调用 + Tauri 仅做窗口壳 | ⛔ **待确认 ②** |
| R-10 | **API 成本失控** | 低 | 中 | 批量分析前给出预估调用次数；加单次会话上限 | ⬜ M1 |
| R-11 | **单人项目中断**：无 bus factor | 高 | 中 | 文档驱动；M0.5 补齐 CONTRIBUTING | 🟡 |

### 8.2 ⛔ 待补充的关键信息（按影响排序）

| # | 需要确认 | 为什么会影响交付物 |
|---|---|---|
| **①** | **技术栈终局**：Agent 内核放**前端 TS** 还是**后端 Rust**？（`DESIGN.md` 写 Rust，但 M0 实现在 TS） | 决定 M1 是"改 2 个文件"还是"重写 1 个模块 + 新建 `src-tauri/`"；排期差 **5 人日** |
| **②** | **Rust 熟练度**：能否自己写 Rust？不能的话 Tauri 后端谁来做？ | 若不能，建议退到"Tauri 仅做窗口壳 + TS 干全部逻辑"，省掉 M1b 的 2 天并降低 R-09 |
| **③** | **团队规模**：就一个人，还是有队友？队友负责哪块？ | 决定排期是"人日并行"还是"人日串行"；也决定 CONTRIBUTING 是否需要协作规范 |
| **④** | **投入强度**：全职 / 业余每周几小时？ | 上面所有工期换算的基准。业余每周 10h 的话，M1 从 3 天变 2 周 |
| **⑤** | **首发是桌面 GUI 还是 MCP server 优先**？（`DESIGN.md` 说 GUI 先，`OPEN_SOURCE_PLAN.md` 的 M0 是 MCP） | 两份文档的 M0 定义**不一致**，需要拍板，否则 M4 会变成返工 |
| **⑥** | **目标用户与首发清单**：先给自己/战队用，还是直接公开给陌生人用？ | 决定文档与打包的完备度门槛 |
| **⑦** | **真实 pcap 样本**：有没有可公开的标准测试集？ | 契约测试与性能测试都要样本，没有就只能用合成 pcap |
| **⑧** | **开源仓库归属**：个人号还是战队组织 `YunkaiSec`？ | 决定 LICENSE 版权人与 README 徽章链接 |
| **⑨** | **模型选型与预算**：DeepSeek 还是其他？是否接受付费调用？ | 决定 `DEFAULT_CONFIG.baseUrl/model` 的默认值和文档示例 |
| **⑩** | **是否需要 MCP 外壳（F-18）** | 若不需要，可砍掉整个 M4，直接省 3 人日 |

---

## 九、交付清单

**状态图例：** ✅ 已完成并验证 · ⚠️ 部分（代码就绪未断言） · ⬜ 未开始 · ⛔ 阻塞（待信息）

### 9.1 源码与配置文件

| # | 交付物 | 路径 | 验收标准 | 状态 |
|---|---|---|---|---|
| D-01 | 工程骨架 | `package.json`/`vite.config.ts`/`tsconfig.json`/`index.html` | `npm install && npm run build` 无错误产出 `dist/` | ✅ |
| D-02 | 数据模型 | `src/data/flow.ts` | 类型定义完整，strict 模式零错误 | ✅ |
| D-03 | 配置层 | `src/agent/agent.config.ts` | 三级优先级生效；`enabled=false` 时零请求 | ✅ |
| D-04 | 调用层 | `src/agent/agentClient.ts` | SSE 流式可用；7 类错误可分类；可取消 | ✅ |
| D-05 | 上下文层 | `src/agent/prompts.ts` | 五段式输出结构稳定；超长可裁剪 | ✅ |
| D-06 | 安全层 | `src/agent/redact.ts` | 10 条测试用例（T-01~T-10）全绿 | ⚠️ **代码就绪，测试未写** |
| D-07 | 右键菜单 | `src/components/ContextMenu.tsx`、`useContextMenu.ts` | 列表与详情区均可触发；ESC/外部点击可关闭 | ✅ |
| D-08 | 列表与详情 | `PacketList.tsx`、`FlowDetail.tsx` | 菜单目标决策符合 F-02 | ✅ |
| D-09 | AI 侧边栏 | `AiAnalysisPanel.tsx`、`useAgentAnalysis.ts` | 流式/复制/重分析/停止均可用 | ⚠️ 错误重试路径未断言 |
| D-10 | 设置面板 | `AgentSettings.tsx` | 改配置立即生效；可恢复默认 | ✅ |
| D-11 | 样式 | `src/styles/app.css` | 浅色主题；信息密度可比 Wireshark | ✅ |
| D-12 | **tshark 封装** | `src/engine/tshark.ts` | 真实 pcap → `FlowRecord[]`；无 libwireshark 链接 | ⬜ ⛔ 待① |
| D-13 | **Tauri 后端** | `src-tauri/**` | `npm run tauri build` 产出可执行文件 | ⬜ ⛔ 待①② |
| D-14 | **聚合层** | `src/aggregate/**` | 100MB pcap 不超 token 上限 | ⬜ M2 |
| D-15 | **工具集（5 个）** | `src/tools/**` | 每个工具有 schema + 单测 | ⬜ M2 |
| D-16 | **批量队列** | `src/batch/**` | 并发上限 2；可取消；失败可重试 | ⬜ M1c |

### 9.2 接口文档与使用说明

| # | 交付物 | 路径 | 验收标准 | 状态 |
|---|---|---|---|---|
| D-17 | 项目 README | `README.md` | 定位/安装/用法/文件清单/解耦边界齐全 | ✅ |
| D-18 | 架构设计文档 | `DESIGN.md` | 分层/数据流/选型/风险齐全 | ✅ |
| D-19 | 开源合规方案 | `OPEN_SOURCE_PLAN.md` | 含 arm's length 红线表 | ✅ |
| D-20 | 本开发说明与交付清单 | `DEVELOPMENT_PLAN.md` | 本文档落盘 | ✅ |
| D-21 | 配置项说明 | `README.md` + `AgentSettings.tsx` | 10 个配置项均有说明与默认值 | ✅ |
| D-22 | API/接口文档 | `docs/API.md` | `FlowRecord`、调用签名、错误码表 | ⬜ ⛔ 待① |
| D-23 | 工具集设计文档 | `docs/TOOL_DESIGN.md` | 5 个工具的 schema 与返回样例 | ⬜ M2 |
| D-24 | 用户手册 | `docs/USER_GUIDE.md` | 从安装到出第一份报告 | ⬜ M5 |

### 9.3 测试用例与测试报告

| # | 交付物 | 路径 | 验收标准 | 状态 |
|---|---|---|---|---|
| D-25 | 脱敏单测 | `src/agent/redact.test.ts` | T-01~T-06 全绿（含 T-06 反向断言） | ⬜ **建议立即做** |
| D-26 | 错误分类单测 | `src/agent/agentClient.test.ts` | T-08/T-09 全绿（mock fetch） | ⬜ **建议立即做** |
| D-27 | 上下文裁剪单测 | `src/agent/prompts.test.ts` | T-07 全绿 | ⬜ |
| D-28 | E2E 验证记录 | `verify-ai-panel.png` | 截图可复现右键→分析→流式 | ✅ |
| D-29 | 测试报告 | `docs/TEST_REPORT.md` | 用例数/通过数/覆盖率/已知缺陷 | ⬜ |
| D-30 | 性能测试报告 | `docs/PERF_REPORT.md` | 100MB pcap 的耗时/内存/token 数 | ⬜ M2 |

### 9.4 构建部署脚本与环境配置

| # | 交付物 | 路径 | 验收标准 | 状态 |
|---|---|---|---|---|
| D-31 | 开发启动脚本 | `npm run dev` | 一条命令起开发服务器 | ✅ |
| D-32 | 构建脚本 | `npm run build` | 类型检查 + 产物生成 | ✅ |
| D-33 | 测试脚本 | `"test": "node --test"` | 一条命令跑全部单测 | ⬜ |
| D-34 | 环境变量模板 | `.env.example` | 覆盖 4 个可注入变量 | ✅ |
| D-35 | 忽略规则 | `.gitignore` | 依赖/产物/`.env*`/Rust target 全覆盖 | ✅ |
| D-36 | **打包脚本** | `npm run tauri build` | 产出 msi/nsis（Win）、dmg（mac）、appimage（Linux） | ⬜ ⛔ 待①② |
| D-37 | **CI 流水线** | `.github/workflows/ci.yml` | lint+typecheck+test+build 全绿；含 GPL 合规检查 | ⬜ |
| D-38 | 依赖安全扫描 | `cargo audit` + `npm audit` | CI 中零 high/critical | ⬜ M5 |

### 9.5 数据表与迁移脚本

| # | 交付物 | 验收标准 | 状态 |
|---|---|---|---|
| — | **本项目无数据库，无数据表，无迁移脚本** | — | ✅ 不适用 |

> **说明**：SharkAgent 是本地单机桌面工具，配置存 `localStorage`、密钥交 OS keyring，没有服务端也没有持久化实体，**"交付数据表与迁移脚本"这一项在本项目里不成立**。若未来要做"分析历史/团队共享"，届时才需要 SQLite（本地）或 PostgreSQL（服务端），现在建表属投机性设计。

### 9.6 开源必备文件（**当前最大缺口**）

| # | 交付物 | 验收标准 | 状态 |
|---|---|---|---|
| D-39 | `LICENSE` | Apache-2.0 全文 + 版权人 + 年份 | ⬜ ⛔ 待⑧ |
| D-40 | `CONTRIBUTING.md` | 开发环境/提交规范/PR 流程 | ⬜ |
| D-41 | `CODE_OF_CONDUCT.md` | 采用 Contributor Covenant 2.1 | ⬜ |
| D-42 | `SECURITY.md` | 私密漏洞上报渠道（邮箱/PGP） | ⬜ |
| D-43 | 商标声明 | 明确不隶属于 Wireshark 官方 | ⬜ |

---

## 十、立即可以开工的三件事（不依赖任何待确认项）

| 顺序 | 任务 | 工作量 | 收益 |
|---|---|---|---|
| 1 | 补 D-25/D-26/D-27 三个单测（`node:test`，零新依赖） | 0.5 天 | 锁住脱敏与错误分类两条安全/钱路径 |
| 2 | 补 D-39~D-43 开源必备文件 | 0.5 天 | 解除"不能公开"阻塞 |
| 3 | `git init` + 首次提交（把 `wireshark/` 排除或加 submodule） | 0.2 天 | 有回滚点，能开工 M1 |
