'use client';
import { useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { SearchField } from '@/components/ui';

export function StorefrontSearch({ initialQ }: { initialQ: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(initialQ);

  function submit(next: string): void {
    const params = new URLSearchParams(searchParams.toString());
    const trimmed = next.trim().slice(0, 80);
    if (trimmed) params.set('q', trimmed);
    else params.delete('q');
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        submit(value);
      }}
      style={{ maxWidth: 520, marginBottom: 'clamp(18px,3vw,28px)' }}
    >
      <SearchField
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="In diesen Ergebnissen suchen — Titel oder Künstler…"
        aria-label="In diesen Ergebnissen suchen"
      />
    </form>
  );
}
