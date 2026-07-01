// src/app/(app)/wunschlisten/page.tsx
// RSC: auth + staff gate → load wishlists + pending matches → render the Wunschlisten screen (spec §5.4/§5.5).

import { requireSession } from '@/auth/session';
import { forbidden } from 'next/navigation';
import { getCurrentTenant } from '@/lib/tenant';
import { listWishlists, listPendingMatches } from '@/lib/wishlist';
import { WishlistForm } from './_components/WishlistForm';
import { WishlistList } from './_components/WishlistList';
import { MatchesSection } from './_components/MatchesSection';

export default async function WunschlistenPage() {
  const user = await requireSession();
  // Staff gate (spec §5.7): wishlists are not customer-facing.
  if (user.role === 'kunde') forbidden();

  const tenant = await getCurrentTenant();
  const ctx = { tenantId: tenant.id, userId: user.id };
  const [wishlists, matches] = await Promise.all([listWishlists(ctx), listPendingMatches(ctx)]);

  return (
    <div
      data-testid="wishlist-screen"
      style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 1100 }}
    >
      <header style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: 'clamp(20px,3vw,26px)',
            letterSpacing: '-.02em',
            margin: 0,
          }}
        >
          Wunschlisten
        </h1>
        <p style={{ color: 'var(--text-2)', fontSize: '15px', margin: 0 }}>
          Kundenwünsche erfassen und bei passendem Ankauf benachrichtigen.
        </p>
      </header>

      <WishlistForm />
      <MatchesSection matches={matches} tenantName={tenant.name} />
      <WishlistList wishlists={wishlists} />
    </div>
  );
}
