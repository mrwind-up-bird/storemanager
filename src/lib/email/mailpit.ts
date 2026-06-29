import nodemailer from 'nodemailer';
import { env } from '@/env';
import type { EmailAdapter, EmailMessage } from './index';

export function createMailpitEmailAdapter(): EmailAdapter {
  // One transporter per adapter instance; no auth (Mailpit dev server).
  const transporter = nodemailer.createTransport({
    host: env.MAIL_HOST,
    port: env.MAIL_PORT,
    secure: false,
  });

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
