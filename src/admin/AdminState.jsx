import { Icons } from '../components/ui';

/**
 * Shared loading, empty, and error state for Admin pages. Keeping these states
 * visually consistent makes it clear that a sparse screen is intentional —
 * not a panel that failed to render.
 */
export default function AdminState({
  icon = 'inbox',
  title,
  detail,
  kind = 'empty',
  compact = false,
  role,
}) {
  const Icon = Icons[icon] || Icons.inbox;
  const className = [
    'admin-empty',
    compact ? 'admin-empty--compact' : '',
    kind === 'loading' ? 'admin-empty--loading' : '',
    kind === 'error' ? 'admin-empty--error' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={className}
      role={role || (kind === 'error' ? 'alert' : 'status')}
      aria-live={kind === 'error' ? 'assertive' : 'polite'}
    >
      <span className="admin-empty__icon" aria-hidden="true"><Icon size={21} /></span>
      <strong>{title}</strong>
      {detail && <span>{detail}</span>}
    </div>
  );
}
