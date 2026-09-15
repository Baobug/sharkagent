/**
 * flow.ts —— 流量条目数据模型 + 上下文提取 + 敏感字段脱敏
 *
 * 【作用】定义"分析对象"的标准结构，并把一条流量整理成可喂给模型的上下文。
 * 与 UI 解耦：任何能产出 FlowRecord 的数据源（本地 pcap / 后端 API / 实时抓包）都可直接复用。
 */

/** 一条 HTTP 流量的标准结构 */
export interface FlowRecord {
  /** 帧号 / 列表序号 */
  frameNo: number;
  /** 时间（相对或绝对，仅用于展示） */
  time: string;
  /** 源地址:端口 */
  source: string;
  /** 目的地址:端口 */
  destination: string;
  /** 传输层协议，如 TCP / UDP */
  protocol: string;
  /** 应用层协议，如 HTTP / TLSv1.3 / DNS */
  appProtocol: string;
  /** 物理/数据链路层协议名，如 Ethernet II（可选，来自详情区） */
  linkProtocol?: string;
  /** 链路层源/目的 MAC（可选） */
  ethSrc?: string;
  ethDst?: string;
  /** 包长度（字节） */
  length: number;
  /** 简化描述（Wireshark Info 列） */
  info: string;

  /** 以下为 HTTP 相关字段，非 HTTP 流量可缺省 */
  method?: string;
  url?: string;
  statusCode?: number;
  /** 服务端耗时（毫秒），来自 time_starttransfer - time_starttransfer 或响应体大小推算 */
  durationMs?: number;
  /** 请求头（原始文本） */
  requestHeaders?: string;
  /** 请求体（原始文本） */
  requestBody?: string;
  /** 响应头（原始文本） */
  responseHeaders?: string;
  /** 响应体（原始文本，可能被截断） */
  responseBody?: string;
  /** 是否被截断（原文过长） */
  bodyTruncated?: boolean;
}
