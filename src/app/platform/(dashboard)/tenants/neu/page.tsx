import { env } from '@/env';
import { CreateTenantForm } from './CreateTenantForm';

export default function TenantNeuPage() {
  return (
    <section>
      <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 24, marginTop: 0 }}>
        Tenant anlegen
      </h1>
      <CreateTenantForm rootDomain={env.ROOT_DOMAIN} />
    </section>
  );
}
