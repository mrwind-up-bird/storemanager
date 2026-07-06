import { z } from 'zod';

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
