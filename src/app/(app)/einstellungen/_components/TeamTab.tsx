import type { TeamUser } from '@/lib/team';
import { CreateUserForm } from './CreateUserForm';
import { ResetPasswordButton } from './ResetPasswordButton';

const dateDE = (d: Date | null): string =>
  d ? new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' }).format(d) : '—';

/** User-Liste + Anlage (Spec §12) — KEIN Löschen in diesem Slice (Verkaufs-/Audit-Bezüge). */
export function TeamTab({ users }: { users: TeamUser[] }) {
  return (
    <div data-testid="team-tab" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--text-2)' }}>
              <th style={{ padding: '8px 10px' }}>E-Mail</th>
              <th style={{ padding: '8px 10px' }}>Rolle</th>
              <th style={{ padding: '8px 10px' }}>Angelegt am</th>
              <th style={{ padding: '8px 10px' }} aria-label="Aktionen" />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} data-testid="team-user-row" style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '8px 10px', fontWeight: 600 }}>{u.email}</td>
                <td style={{ padding: '8px 10px', textTransform: 'capitalize' }}>{u.role}</td>
                <td style={{ padding: '8px 10px', color: 'var(--text-3)' }}>{dateDE(u.createdAt)}</td>
                <td style={{ padding: '8px 10px' }}>
                  <ResetPasswordButton userId={u.id} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <h2 style={{ fontSize: 16, margin: '0 0 10px' }}>Neuen User anlegen</h2>
        <CreateUserForm />
      </div>
    </div>
  );
}
