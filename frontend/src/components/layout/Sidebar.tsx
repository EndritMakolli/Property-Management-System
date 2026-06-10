import { NavLink } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { PLATFORMS, usePlatform, type PlatformId } from '../../context/PlatformContext'
import { navItemsForRole } from './navItems'

export function Sidebar() {
  const { user } = useAuth()
  const { platform, switchPlatform } = usePlatform()

  const navItems = navItemsForRole(user.role, platform.id).map((item) =>
    item.label === 'Properties' ? { ...item, label: platform.propertiesLabel } : item,
  )

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark" style={{ background: platform.brandColor }}>
          {platform.brandMark}
        </div>
        <div>
          <strong>{platform.brandName}</strong>
          <span>{platform.tagline}</span>
        </div>
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
