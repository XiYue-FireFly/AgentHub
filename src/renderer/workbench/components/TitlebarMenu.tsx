import React from 'react'

export type MenuId = 'file' | 'view' | 'help'

export interface MenuItem {
  label: string
  shortcut?: string
  checked?: boolean
  action: (event: React.MouseEvent) => void
}

interface TitlebarMenuProps {
  id: MenuId
  label: string
  openMenu: MenuId | null
  setOpenMenu: (menu: MenuId | null) => void
  items: MenuItem[]
}

export function TitlebarMenu({ id, label, openMenu, setOpenMenu, items }: TitlebarMenuProps) {
  const open = openMenu === id
  return (
    <div className="wb-menu-wrap app-no-drag" onPointerDown={event => event.stopPropagation()}>
      <button
        type="button"
        className={'wb-menu' + (open ? ' active' : '')}
        onClick={event => {
          event.stopPropagation()
          setOpenMenu(open ? null : id)
        }}
      >
        {label}
      </button>
      {open && (
        <div className="wb-menu-dropdown">
          {items.map(item => (
            <button key={item.label} type="button" onClick={item.action}>
              <span className="wb-menu-check">{item.checked ? '✓' : ''}</span>
              <span>{item.label}</span>
              {item.shortcut && <small>{item.shortcut}</small>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
