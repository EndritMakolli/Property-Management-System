import type { LucideIcon } from 'lucide-react'

type PanelHeaderProps = {
  action?: string
  icon: LucideIcon
  onAction?: () => void
  title: string
}

export function PanelHeader({ action, icon: Icon, onAction, title }: PanelHeaderProps) {
  return (
    <div className="panel-header">
      <div>
        <Icon size={18} />
        <h2>{title}</h2>
      </div>
      {action && <button onClick={onAction}>{action}</button>}
    </div>
  )
}
