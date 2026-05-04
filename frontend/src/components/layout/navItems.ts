import {
  BarChart3,
  Building2,
  CalendarDays,
  CalendarRange,
  CircleDollarSign,
  KeyRound,
  LayoutDashboard,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Users,
} from 'lucide-react'
import type { UserRole } from '../../types/domain'

type NavRole = Exclude<UserRole, ''>

export const navItems: { label: string; path: string; icon: typeof Search; roles: NavRole[] }[] = [
  { label: 'Availability', path: '/availability', icon: Search, roles: ['admin', 'management'] },
  { label: 'Dashboard', path: '/', icon: LayoutDashboard, roles: ['admin', 'management', 'cleaning'] },
  { label: 'Reservations', path: '/reservations', icon: CalendarDays, roles: ['admin', 'management'] },
  { label: 'Calendar', path: '/calendar', icon: CalendarRange, roles: ['admin', 'management'] },
  { label: 'Properties', path: '/properties', icon: Building2, roles: ['admin', 'management'] },
  { label: 'Reports', path: '/reports', icon: BarChart3, roles: ['admin'] },
  { label: 'Codes', path: '/codes', icon: KeyRound, roles: ['admin', 'management'] },
  { label: 'Synchronizations', path: '/synchronizations', icon: RefreshCw, roles: ['admin', 'management'] },
  { label: 'Admin Panel', path: '/admin-panel', icon: ShieldCheck, roles: ['admin'] },
  { label: 'Guests', path: '/guests', icon: Users, roles: ['admin', 'management'] },
  { label: 'Finance', path: '/finance', icon: CircleDollarSign, roles: ['admin'] },
  { label: 'Settings', path: '/settings', icon: Settings, roles: ['admin', 'management'] },
]

export function navItemsForRole(role: UserRole) {
  if (!role) return []
  return navItems.filter((item) => item.roles.includes(role as NavRole))
}
