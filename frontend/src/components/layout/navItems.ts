import {
  BarChart3,
  FileText,
  Building2,
  CalendarDays,
  CalendarRange,
  CircleDollarSign,
  Globe,
  Gauge,
  KeyRound,
  LayoutDashboard,
  Lock,
  MessageSquare,
  Receipt,
  RefreshCw,
  Search,
  ShieldCheck,
  Tag,
  Users,
  Wallet,
  Wrench,
} from 'lucide-react'
import type { PlatformId } from '../../context/PlatformContext'
import type { UserRole } from '../../types/domain'

type NavRole = Exclude<UserRole, ''>

type NavItem = {
  label: string
  path: string
  icon: typeof Search
  roles: NavRole[]
  /** Omit to show on every platform. */
  platforms?: PlatformId[]
  /** One route, two pages: the entry is renamed and re-iconed per platform. */
  perPlatform?: Partial<Record<PlatformId, { label: string; icon: typeof Search }>>
}

export const navItems: NavItem[] = [
  { label: 'Search', path: '/availability', icon: Search, roles: ['admin', 'management'] },
  { label: 'Reservations', path: '/reservations', icon: CalendarDays, roles: ['admin', 'management'] },
  { label: 'Calendar', path: '/calendar', icon: CalendarRange, roles: ['admin', 'management'] },
  { label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard, roles: ['admin', 'management', 'cleaning'] },
  { label: 'Properties', path: '/properties', icon: Building2, roles: ['admin', 'management'] },
  // Same route, different page behind it: door codes and wifi for an
  // apartment, service and registration for a vehicle. Gating it to AirStay is
  // what left the Fleet page built and unreachable.
  {
    label: 'Codes',
    path: '/codes',
    icon: KeyRound,
    roles: ['admin', 'management', 'cleaning'],
    perPlatform: { fleet: { label: 'Service', icon: Gauge } },
  },
  { label: 'To Fix', path: '/maintenance', icon: Wrench, roles: ['admin', 'management', 'cleaning'] },
  { label: 'Reports', path: '/reports', icon: BarChart3, roles: ['admin'] },
  { label: 'Finance', path: '/finance', icon: CircleDollarSign, roles: ['admin'] },
  { label: 'Clients', path: '/clients', icon: Users, roles: ['admin', 'management'] },
  { label: 'Payments', path: '/payments', icon: Wallet, roles: ['admin', 'management'] },
  { label: 'Invoices', path: '/invoices', icon: FileText, roles: ['admin', 'management'] },
  { label: 'Receipts', path: '/receipts', icon: Receipt, roles: ['admin'] },
  { label: 'Synchronizations', path: '/synchronizations', icon: RefreshCw, roles: ['admin', 'management'] },
  { label: 'Booking Requests', path: '/booking-requests', icon: Globe, roles: ['admin', 'management'] },
  { label: 'Pricing Rules', path: '/pricing-rules', icon: Tag, roles: ['admin', 'management'] },
  // Holds both the guest replies and the rental contracts, so it is named for
  // what it is rather than for the half of it that came first.
  { label: 'Templates', path: '/message-templates', icon: MessageSquare, roles: ['admin', 'management'] },
  { label: 'Admin Panel', path: '/admin-panel', icon: ShieldCheck, roles: ['admin'] },
  { label: 'My Security', path: '/security', icon: Lock, roles: ['admin', 'management', 'cleaning'] },
]

export function navItemsForRole(role: UserRole, platformId?: PlatformId) {
  if (!role) return []
  return navItems
    .filter(
      (item) =>
        item.roles.includes(role as NavRole) &&
        (!item.platforms || !platformId || item.platforms.includes(platformId)),
    )
    .map((item) => {
      const override = platformId ? item.perPlatform?.[platformId] : undefined
      return override ? { ...item, label: override.label, icon: override.icon } : item
    })
}
