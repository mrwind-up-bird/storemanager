import { env } from '@/env';
import { createConsoleEmailAdapter } from './console';
import { createMailpitEmailAdapter } from './mailpit';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailAdapter {
  send(msg: EmailMessage): Promise<void>;
}

export function getEmailAdapter(): EmailAdapter {
  switch (env.MAIL_DRIVER) {
    case 'mailpit':
      return createMailpitEmailAdapter();
    case 'console':
      return createConsoleEmailAdapter();
    default: {
      // TypeScript exhaustiveness guard — env schema allows only two values.
      const exhaustive: never = env.MAIL_DRIVER;
      throw new Error(`Unknown MAIL_DRIVER: ${String(exhaustive)}`);
    }
  }
}

export async function sendCredentialsEmail(
  adapter: EmailAdapter,
  args: {
    to: string;
    tenantName: string;
    loginUrl: string;
    temporaryPassword: string;
  },
): Promise<void> {
  const { to, tenantName, loginUrl, temporaryPassword } = args;

  const subject = `Dein Q-Records Zugang`;

  const html = `<!DOCTYPE html>
<html lang="de">
<head><meta charset="utf-8" /><title>${subject}</title></head>
<body style="font-family:sans-serif;color:#111;max-width:480px;margin:0 auto;padding:24px">
  <h1 style="font-size:1.25rem;margin-bottom:8px">Willkommen bei ${tenantName}</h1>
  <p style="margin-bottom:16px">Hier sind deine Zugangsdaten für Q-Records:</p>
  <table style="border-collapse:collapse;width:100%;margin-bottom:16px">
    <tr>
      <td style="padding:6px 12px;font-weight:bold;white-space:nowrap">Login-URL</td>
      <td style="padding:6px 12px">
        <a href="${loginUrl}" style="color:#c84b31">${loginUrl}</a>
      </td>
    </tr>
    <tr style="background:#f5f5f5">
      <td style="padding:6px 12px;font-weight:bold;white-space:nowrap">Temporäres Passwort</td>
      <td style="padding:6px 12px;font-family:monospace;letter-spacing:0.05em">${temporaryPassword}</td>
    </tr>
  </table>
  <p style="font-size:0.875rem;color:#555">
    Bitte ändere dein Passwort nach der ersten Anmeldung.
  </p>
</body>
</html>`;

  const text = [
    `Willkommen bei ${tenantName}`,
    '',
    'Hier sind deine Zugangsdaten für Q-Records:',
    '',
    `Login-URL:            ${loginUrl}`,
    `Temporäres Passwort:  ${temporaryPassword}`,
    '',
    'Bitte ändere dein Passwort nach der ersten Anmeldung.',
  ].join('\n');

  await adapter.send({ to, subject, html, text });
}
