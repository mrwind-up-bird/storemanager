import Link from 'next/link';
import { listTenantsWithStats } from '@/lib/platform/tenants';
import { env, tenantUrl } from '@/env';

const dateDE = (d: Date | null): string =>
  d ? new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' }).format(d) : '—';

export default async function PlatformTenantListPage() {
  const rows = await listTenantsWithStats();
  return (
    <section data-testid="platform-tenant-list">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 24, margin: 0 }}>
          Tenants
        </h1>
        <Link
          href="/tenants/neu"
          data-testid="platform-tenant-create-link"
          style={{
            marginLeft: 'auto',
            minHeight: 'var(--tap)',
            display: 'inline-flex',
            alignItems: 'center',
            padding: '0 16px',
            borderRadius: 'var(--r-pill)',
            background: 'var(--accent)',
            color: 'var(--on-accent)',
            fontWeight: 700,
            fontSize: 14,
            textDecoration: 'none',
          }}
        >
          Tenant anlegen
        </Link>
      </div>
      <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: 'var(--surface-2)', textAlign: 'left' }}>
              {['Name', 'Slug', 'Plan', 'Platten', 'User', 'Angelegt am'].map((h) => (
                <th key={h} style={{ padding: '10px 14px', fontWeight: 700, color: 'var(--text-2)' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} data-testid="platform-tenant-row" style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '10px 14px', fontWeight: 600 }}>
                  <Link href={`/tenants/${t.id}`} style={{ color: 'var(--accent-ink)', textDecoration: 'none' }}>
                    {t.name}
                  </Link>
                </td>
                <td style={{ padding: '10px 14px' }}>
                  <a href={tenantUrl(t.slug)} style={{ color: 'var(--text-2)' }}>
                    {t.slug}.{env.ROOT_DOMAIN}
                  </a>
                </td>
                <td style={{ padding: '10px 14px', textTransform: 'capitalize' }}>{t.plan}</td>
                <td style={{ padding: '10px 14px' }}>{t.recordCount}</td>
                <td style={{ padding: '10px 14px' }}>{t.userCount}</td>
                <td style={{ padding: '10px 14px', color: 'var(--text-3)' }}>{dateDE(t.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
