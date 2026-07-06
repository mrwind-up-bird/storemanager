import { z } from 'zod';

// zod-Schema getrennt von actions.ts: eine 'use server'-Datei darf NUR async Server Actions
// exportieren — ein `export const <schema>` lässt `next build` mit „Server Actions must be
// async functions" scheitern. Die Unit-Tests (Spec §14) importieren das Schema von hier.
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Bitte das aktuelle Passwort eingeben.'),
    newPassword: z.string().min(12, 'Das neue Passwort muss mindestens 12 Zeichen haben.'),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: 'Die Passwörter stimmen nicht überein.',
    path: ['confirmPassword'],
  });
