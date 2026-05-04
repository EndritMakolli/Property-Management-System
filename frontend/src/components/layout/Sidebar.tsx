import { NavLink } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { navItemsForRole } from './navItems'

export function Sidebar() {
  const { user } = useAuth()
  const navItems = navItemsForRole(user.role)

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">A</div>
        <div>
          <strong>AirStay</strong>
          <span>Property operations</span>
        </div>
      </div>

      <nav className="nav-list" aria-label="Main navigation">
        {navItems.map((item) => (
          <NavLink
            className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
            end={item.path === '/'}
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
