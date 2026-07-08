import nodemailer from 'nodemailer';
import { env } from '@/env';
import type { EmailAdapter, EmailMessage } from './index';
import { mailpitTransportOptions } from './smtpOptions';

export function createMailpitEmailAdapter(): EmailAdapter {
  // One transporter per adapter instance; no auth (Mailpit dev server / internal relay).
  const transporter = nodemailer.createTransport(
    mailpitTransportOptions({
      host: env.MAIL_HOST,
      port: env.MAIL_PORT,
      insecure: env.MAIL_SMTP_INSECURE === '1',
    }),
  );

  return {
    async send(msg: EmailMessage): Promise<void> {
      await transporter.sendMail({
        from: env.MAIL_FROM,
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      });
    },
  };
}
