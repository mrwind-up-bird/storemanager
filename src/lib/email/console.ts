import type { EmailAdapter, EmailMessage } from './index';

export function createConsoleEmailAdapter(): EmailAdapter {
  return {
    async send(msg: EmailMessage): Promise<void> {
      console.log('[Email:console] ─────────────────────────────');
      console.log(`[Email:console] To:      ${msg.to}`);
      console.log(`[Email:console] Subject: ${msg.subject}`);
      console.log('[Email:console] Text:');
      console.log(msg.text);
      console.log('[Email:console] ─────────────────────────────');
    },
  };
}
