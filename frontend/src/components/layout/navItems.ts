import {
  AlertTriangle,
  Archive,
  BarChart3,
  FileText,
  Building2,
  CalendarDays,
  CalendarRange,
  CircleDollarSign,
  Globe,
  KeyRound,
  LayoutDashboard,
  Receipt,
  RefreshCw,
  Search,
  SearchCheck,
  Settings,
  ShieldCheck,
  Tag,
  Wrench,
} from 'lucide-react'
import type { PlatformId } from '../../context/PlatformContext'
import type { UserRole } from '../../types/domain'

type NavRole = Exclude<UserRole, ''>

export const navItems: { label: string; path: string; icon: typeof Search; roles: NavRole[]; platforms?: PlatformId[] }[] = [
  { label: 'Search', path: '/availability', icon: Search, roles: ['admin', 'management'] },
  { label: 'Search Reservations', path: '/search-reservations', icon: SearchCheck, roles: ['admin', 'management'] },
  { label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard, roles: ['admin', 'management', 'cleaning'] },
  { label: 'Calendar', path: '/calendar', icon: CalendarRange, roles: ['admin', 'management'] },
  { label: 'Reservations', path: '/reservations', icon: CalendarDays, roles: ['admin', 'management'] },
  { label: 'Archive', path: '/archive', icon: Archive, roles: ['admin', 'management'] },
  { label: 'Needs Attention', path: '/needs-attention', icon: AlertTriangle, roles: ['admin', 'management'] },
  { label: 'Properties', path: '/properties', icon: Building2, roles: ['admin', 'management'] },
  { label: 'Codes', path: '/codes', icon: KeyRound, roles: ['admin', 'management', 'cleaning'], platforms: ['airstay'] },
  { label: 'To Fix', path: '/maintenance', icon: Wrench, roles: ['admin', 'management', 'cleaning'] },
  { label: 'Reports', path: '/reports', icon: BarChart3, roles: ['admin'] },
  { label: 'Finance', path: '/finance', icon: CircleDollarSign, roles: ['admin'] },
  { label: 'Invoices', path: '/invoices', icon: FileText, roles: ['admin', 'management'] },
  { label: 'Receipts', path: '/receipts', icon: Receipt, roles: ['admin'] },
  { label: 'Synchronizations', path: '/synchronizations', icon: RefreshCw, roles: ['admin', 'management'] },
  { label: 'Booking Requests', path: '/booking-requests', icon: Globe, roles: ['admin', 'management'] },
  { label: 'Pricing Rules', path: '/pricing-rules', icon: Tag, roles: ['admin', 'management'] },
  { label: 'Booking Settings', path: '/booking-settings', icon: Settings, roles: ['admin', 'management'] },
  { label: 'Admin Panel', path: '/admin-panel', icon: ShieldCheck, roles: ['admin'] },
]

export function navItemsForRole(role: UserRole, platformId?: PlatformId) {
  if (!role) return []
  return navItems.filter(
    (item) =>
      item.roles.includes(role as NavRole) &&
      (!item.platforms || !platformId || item.platforms.includes(platformId)),
  )
}
