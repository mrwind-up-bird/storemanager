import { describe, it, expect, vi, beforeEach } from 'vitest';

// Module-level mock: all imports of @/env inside this file get this object.
vi.mock('@/env', () => ({
  env: {
    MAIL_DRIVER: 'console' as const,
    MAIL_HOST: 'localhost',
    MAIL_PORT: 1025,
    MAIL_FROM: 'noreply@test.localhost',
  },
}));

// Mock nodemailer so the Mailpit driver never touches a real SMTP server.
const mockSendMail = vi.fn().mockResolvedValue({ messageId: 'mock-id' });
const mockCreateTransport = vi.fn(() => ({ sendMail: mockSendMail }));
vi.mock('nodemailer', () => ({
  default: { createTransport: mockCreateTransport },
}));

describe('email — unit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Cycle A: factory + console driver ─────────────────────────────────────

  describe('getEmailAdapter()', () => {
    it('returns an object with a send function when MAIL_DRIVER=console', async () => {
      const { getEmailAdapter } = await import('@/lib/email/index');
      const adapter = getEmailAdapter();
      expect(typeof adapter.send).toBe('function');
    });
  });

  describe('createConsoleEmailAdapter()', () => {
    it('send() resolves to undefined', async () => {
      const { createConsoleEmailAdapter } = await import('@/lib/email/console');
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const adapter = createConsoleEmailAdapter();
      await expect(
        adapter.send({
          to: 'user@example.com',
          subject: 'Test Subject',
          html: '<p>Hello</p>',
          text: 'Hello',
        }),
      ).resolves.toBeUndefined();
      consoleSpy.mockRestore();
    });

    it('send() logs the recipient and subject', async () => {
      const { createConsoleEmailAdapter } = await import('@/lib/email/console');
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const adapter = createConsoleEmailAdapter();
      await adapter.send({
        to: 'someone@demo.localhost',
        subject: 'Credentialmail',
        html: '<p>x</p>',
        text: 'x',
      });
      // At least one log call must mention the recipient
      const allArgs = consoleSpy.mock.calls.flat().join(' ');
      expect(allArgs).toContain('someone@demo.localhost');
      consoleSpy.mockRestore();
    });
  });

  // ── Cycle A: sendCredentialsEmail content ─────────────────────────────────

  describe('sendCredentialsEmail()', () => {
    it('includes temporaryPassword in both html and text', async () => {
      const { sendCredentialsEmail } = await import('@/lib/email/index');
      const captured: { html: string; text: string }[] = [];
      const mockAdapter = {
        send: vi.fn(async (msg: { html: string; text: string }) => {
          captured.push({ html: msg.html, text: msg.text });
        }),
      };
      const temporaryPassword = 'TMP-XYZ-9A2B';
      await sendCredentialsEmail(mockAdapter, {
        to: 'admin@demo.localhost',
        tenantName: 'Demo Store',
        loginUrl: 'http://demo.localhost/login',
        temporaryPassword,
      });
      expect(mockAdapter.send).toHaveBeenCalledOnce();
      expect(captured[0].html).toContain(temporaryPassword);
      expect(captured[0].text).toContain(temporaryPassword);
    });

    it('includes loginUrl in both html and text', async () => {
      const { sendCredentialsEmail } = await import('@/lib/email/index');
      const captured: { html: string; text: string }[] = [];
      const mockAdapter = {
        send: vi.fn(async (msg: { html: string; text: string }) => {
          captured.push({ html: msg.html, text: msg.text });
        }),
      };
      const loginUrl = 'http://demo.localhost/login';
      await sendCredentialsEmail(mockAdapter, {
        to: 'admin@demo.localhost',
        tenantName: 'Demo Store',
        loginUrl,
        temporaryPassword: 'PASS-123',
      });
      expect(captured[0].html).toContain(loginUrl);
      expect(captured[0].text).toContain(loginUrl);
    });

    it('calls adapter.send with the correct to address', async () => {
      const { sendCredentialsEmail } = await import('@/lib/email/index');
      const mockAdapter = { send: vi.fn().mockResolvedValue(undefined) };
      await sendCredentialsEmail(mockAdapter, {
        to: 'owner@vinylcave.localhost',
        tenantName: 'Vinyl Cave',
        loginUrl: 'http://vinylcave.localhost/login',
        temporaryPassword: 'ABC-456',
      });
      expect(mockAdapter.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'owner@vinylcave.localhost' }),
      );
    });

    it('sends a non-empty subject', async () => {
      const { sendCredentialsEmail } = await import('@/lib/email/index');
      const mockAdapter = { send: vi.fn().mockResolvedValue(undefined) };
      await sendCredentialsEmail(mockAdapter, {
        to: 'x@x.localhost',
        tenantName: 'My Shop',
        loginUrl: 'http://x.localhost/login',
        temporaryPassword: 'PWD',
      });
      const msg = (mockAdapter.send.mock.calls[0] as [{ subject: string }])[0];
      expect(msg.subject.length).toBeGreaterThan(0);
    });
  });

  // ── Cycle B: Mailpit driver (SMTP via nodemailer mock) ────────────────────

  describe('createMailpitEmailAdapter()', () => {
    it('calls nodemailer.createTransport with the configured host and port', async () => {
      const { createMailpitEmailAdapter } = await import('@/lib/email/mailpit');
      createMailpitEmailAdapter();
      expect(mockCreateTransport).toHaveBeenCalledWith(
        expect.objectContaining({ host: 'localhost', port: 1025, secure: false }),
      );
    });

    it('send() delegates to transporter.sendMail with from/to/subject/html/text', async () => {
      const { createMailpitEmailAdapter } = await import('@/lib/email/mailpit');
      const adapter = createMailpitEmailAdapter();
      await adapter.send({
        to: 'recipient@example.com',
        subject: 'Hello',
        html: '<p>Hello</p>',
        text: 'Hello',
      });
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'noreply@test.localhost',
          to: 'recipient@example.com',
          subject: 'Hello',
          html: '<p>Hello</p>',
          text: 'Hello',
        }),
      );
    });
  });
});
