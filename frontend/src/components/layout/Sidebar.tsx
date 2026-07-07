import { X } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { PLATFORMS, usePlatform, type PlatformId } from '../../context/PlatformContext'
import { navItemsForRole } from './navItems'

type SidebarProps = {
  open?: boolean
  onClose?: () => void
}

export function Sidebar({ open = false, onClose }: SidebarProps) {
  const { user } = useAuth()
  const { platform, switchPlatform } = usePlatform()

  const navItems = navItemsForRole(user.role, platform.id).map((item) =>
    item.label === 'Properties' ? { ...item, label: platform.propertiesLabel } : item,
  )

  return (
    <aside className={`sidebar${open ? ' open' : ''}`}>
      <div className="brand">
        <div className="brand-mark" style={{ background: platform.brandColor }}>
          {platform.brandMark}
        </div>
        <div>
          <strong>{platform.brandName}</strong>
          <span>{platform.tagline}</span>
        </div>
        {onClose && (
          <button
            aria-label="Close menu"
            className="sidebar-close"
            onClick={onClose}
            type="button"
          >
            <X size={20} />
          </button>
        )}
      </div>

      <div className="platform-switcher">
        {(Object.keys(PLATFORMS) as PlatformId[]).map((id) => (
          <button
            key={id}
            type="button"
            className={`platform-pill${platform.id === id ? ' active' : ''}`}
            onClick={() => switchPlatform(id)}
          >
            {PLATFORMS[id].brandName}
          </button>
        ))}
      </div>

      <nav className="nav-list" aria-label="Main navigation">
        {navItems.map((item) => (
          <NavLink
            className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
            end={item.path === '/dashboard'}
            key={item.path}
            onClick={onClose}
            to={item.path}
          >
            <item.icon size={18} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

    </aside>
  )
}
