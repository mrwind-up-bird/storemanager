import { describe, expect, it } from 'vitest';
import { mailpitTransportOptions } from '@/lib/email/smtpOptions';

describe('mailpitTransportOptions', () => {
  it('defaults to plain SMTP with opportunistic TLS (secure:false, no overrides)', () => {
    const opts = mailpitTransportOptions({ host: 'mailpit', port: 1025, insecure: false }) as Record<string, unknown>;
    expect(opts.host).toBe('mailpit');
    expect(opts.port).toBe(1025);
    expect(opts.secure).toBe(false);
    expect(opts.ignoreTLS).toBeUndefined();
    expect(opts.tls).toBeUndefined();
  });

  it('skips STARTTLS and self-signed validation for the internal relay when insecure', () => {
    const opts = mailpitTransportOptions({ host: 'mailserver', port: 25, insecure: true }) as Record<string, unknown>;
    expect(opts.host).toBe('mailserver');
    expect(opts.port).toBe(25);
    expect(opts.secure).toBe(false);
    expect(opts.ignoreTLS).toBe(true);
    expect(opts.tls).toEqual({ rejectUnauthorized: false });
  });
});
