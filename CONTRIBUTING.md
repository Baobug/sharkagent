# 贡献指南

## 先读这三条

1. **不要修改 Wireshark 源码。** 本项目通过子进程 / socket 调用 `tshark` / `sharkd`，与 Wireshark 保持 arm's length 关系。往 `wireshark/` 目录里提交代码会引入 GPL-2.0-or-later 传染，违反本项目的 Apache-2.0 许可策略。详见 [`../OPEN_SOURCE_PLAN.md`](../OPEN_SOURCE_PLAN.md)。
2. **不要引入新的运行时依赖**，除非先在 Issue 里说明理由。前端目前只有 `react` / `react-dom` 两个运行时依赖。
3. **不要提交真实抓包数据。** 提交前确认 `*.pcap` / `*.pcapng` / `.env.local` 未被 `git add`。

## 开发环境

```bash
cd shark-agent
npm install
npm run dev        # http://localhost:5173
npm run typecheck  # tsc --noEmit，提交前必须为 0 错误
npm run build      # 产物必须构建成功
```

## 提交前自检

| 检查项 | 命令 | 通过标准 |
|---|---|---|
| 类型检查 | `npm run typecheck` | 0 error |
| 构建 | `npm run build` | 退出码 0 |
| 单元测试（引入后） | `node --test src/**/*.test.ts` | 全绿 |
| 无敏感信息 | 人工检视 diff | 无 key / token / 真实流量 |

## 命名与风格

- 组件文件名用 `PascalCase.tsx`，Hook 用 `useXxx.ts`，纯逻辑模块用 `camelCase.ts`。
- Agent 层（`src/agent/`）**禁止** import React 或触碰 DOM —— 它必须能脱离 UI 独立跑测试。
- 所有对外可见的文案用中文，注释可用中文。

## 提交信息

遵循 Conventional Commits：

```
feat(agent): 支持自定义 extraHeaders
fix(redact): 修复 JWT 正则漏匹配 eyJ 开头
docs(plan): 补充 M1 里程碑完成定义
```

## Pull Request

PR 描述里请写明：
- 解决的 Issue 编号
- 改动的模块
- 是否触及 GPL 边界（若触及，说明为什么合规）
- 自检结果（粘贴 `typecheck` / `build` 输出）

## 报告安全问题

请勿开公开 Issue，走 [`SECURITY.md`](./SECURITY.md) 里的私下渠道。
