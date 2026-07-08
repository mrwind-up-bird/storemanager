import type SMTPTransport from 'nodemailer/lib/smtp-transport';

/**
 * Pure builder for the SMTP transport options — no env, no runtime nodemailer import (the type
 * import above is erased), so it is unit-testable in isolation.
 *
 * Plain SMTP (secure:false) by default — the mailpit adapter doubles as the internal
 * docker-mailserver relay. When `insecure`, STARTTLS is skipped and self-signed validation
 * disabled (internal hop only; see env.MAIL_SMTP_INSECURE).
 */
export function mailpitTransportOptions(cfg: {
  host: string;
  port: number;
  insecure: boolean;
}): SMTPTransport.Options {
  return {
    host: cfg.host,
    port: cfg.port,
    secure: false,
    ...(cfg.insecure ? { ignoreTLS: true, tls: { rejectUnauthorized: false } } : {}),
  };
}
