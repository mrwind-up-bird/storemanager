import { test, expect } from '@playwright/test';
import { MAILPIT_API } from './helpers';

// §9.10: the credential mail dispatched by the seed lands in Mailpit, retrievable via its API.
// Subject is "Dein Q-Records Zugang"; recipients are admin@demo.test / admin@vinylcave.test.

interface MailpitMessage {
  Subject: string;
  To: Array<{ Address: string }>;
}

test('a credential email is present in Mailpit', async ({ request }) => {
  const res = await request.get(`${MAILPIT_API}/messages`);
  expect(res.ok(), 'Mailpit API must be reachable on :8025').toBeTruthy();

  const body = (await res.json()) as { total: number; messages: MailpitMessage[] };
  expect(body.total).toBeGreaterThan(0);

  const credentialMail = body.messages.find((m) =>
    /zugang|passwort|anmeldedaten|password|credential/i.test(m.Subject),
  );
  expect(credentialMail, 'expected a credential email (subject ~ "Zugang")').toBeDefined();
});

test('Mailpit contains a message addressed to the demo admin', async ({ request }) => {
  const res = await request.get(`${MAILPIT_API}/messages`);
  expect(res.ok()).toBeTruthy();

  const body = (await res.json()) as { messages: MailpitMessage[] };
  const toDemo = body.messages.find((m) => m.To.some((t) => t.Address.includes('demo')));
  expect(toDemo, 'expected a mail to admin@demo.test').toBeDefined();
});
