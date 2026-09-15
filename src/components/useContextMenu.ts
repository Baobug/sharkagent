/**
 * useContextMenu.ts —— 通用右键菜单 Hook
 *
 * 【作用】给任意区域注册右键菜单，业务侧只描述"菜单有哪些项 + 点击做什么"。
 * 【解耦】不关心流量、不关心 AI，任何区域都能复用（列表、详情区、将来别的面板）。
 * 支持：
 *   - 屏幕坐标弹出、点击外部/滚动/ESC 自动关闭
 *   - 菜单项可动态禁用（如未选中项时禁用"AI 分析选中"）
 *   - 自动避让视口边缘（防止菜单被截断）
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface MenuItem {
  /** 唯一 key */
  id: string;
  /** 显示文案 */
  label: string;
  /** 点击回调 */
  onSelect: () => void;
  /** 是否禁用 */
  disabled?: boolean;
  /** 是否在其上方插入分隔线 */
  separatorBefore?: boolean;
  /** 是否是危险操作（红色） */
  danger?: boolean;
}

export interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

/** 菜单尺寸估算，用于边缘避让 */
const MENU_W = 220;
const MENU_H_PER_ITEM = 34;

export function useContextMenu() {
  const [menu, setMenu] = useState<MenuState | null>(null);
  // 用 HTMLDivElement 作泛型（非 null 联合）以匹配 React 的 RefObject 类型；
  // 注意 useEffect 中访问 ref.current 前必须先判空。
  const ref = useRef<HTMLDivElement>(undefined!);

  const close = useCallback(() => setMenu(null), []);

  /** 在指定位置打开菜单 */
  const open = useCallback((x: number, y: number, items: MenuItem[]) => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const estH = items.length * MENU_H_PER_ITEM + 12;
    setMenu({
      x: Math.min(x, vw - MENU_W - 8),
      y: Math.min(y, vh - estH - 8),
      items,
    });
  }, []);

  /** 便捷方法：由鼠标事件触发 */
  const openFromEvent = useCallback(
    (e: React.MouseEvent, items: MenuItem[]) => {
      e.preventDefault();
      e.stopPropagation();
      open(e.clientX, e.clientY, items);
    },
    [open],
  );

  useEffect(() => {
    if (!menu) return;
    const onDown = (ev: MouseEvent) => {
      if (ref.current && !ref.current.contains(ev.target as Node)) close();
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') close();
    };
    const onScroll = () => close();
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
    };
  }, [menu, close]);

  return { menu, open, openFromEvent, close, menuRef: ref };
}
