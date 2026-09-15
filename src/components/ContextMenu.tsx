/**
 * ContextMenu.tsx —— 右键菜单渲染组件（纯展示）
 *
 * 【作用】把 useContextMenu 的菜单状态渲染成浮层，不含任何业务判断。
 */

import { useContextMenu, type MenuItem } from './useContextMenu.ts';

interface Props {
  menu: { x: number; y: number; items: MenuItem[] } | null;
  menuRef: React.RefObject<HTMLDivElement>;
  onClose: () => void;
}

export function ContextMenu({ menu, menuRef, onClose }: Props) {
  if (!menu) return null;
  return (
    <div
      ref={menuRef}
      className="ctx-menu"
      style={{ left: menu.x, top: menu.y }}
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
    >
      {menu.items.map((item) => (
        <div key={item.id}>
          {item.separatorBefore && <div className="ctx-sep" />}
          <button
            type="button"
            role="menuitem"
            className={`ctx-item${item.disabled ? ' is-disabled' : ''}${item.danger ? ' is-danger' : ''}`}
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return;
              item.onSelect();
              onClose();
            }}
          >
            {item.label}
          </button>
        </div>
      ))}
    </div>
  );
}

/** 便捷组合：Hook + 组件一起用（外部只需解构一次） */
export function useContextMenuWithRender() {
  const ctx = useContextMenu();
  const node = <ContextMenu menu={ctx.menu} menuRef={ctx.menuRef} onClose={ctx.close} />;
  return { ...ctx, node };
}
