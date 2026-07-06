'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui';
import { testDiscogsConnectionAction } from '../actions';

export function TestConnectionButton() {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Button
        type="button"
        loading={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await testDiscogsConnectionAction();
            setMessage(result.message);
          })
        }
      >
        Verbindung testen
      </Button>
      {message ? <p data-testid="discogs-test-result">{message}</p> : null}
    </div>
  );
}
