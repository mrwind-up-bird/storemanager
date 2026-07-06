import { z } from 'zod';
import { HEX_COLOR_REGEX } from '@/lib/provisioning';

// zod-Schema getrennt von actions.ts: eine 'use server'-Datei darf NUR async Server Actions
// exportieren (sonst scheitert `next build`). Die Unit-Tests (Spec §14) importieren von hier.
export const createTenantSchema = z.object({
  slug: z.string().trim().toLowerCase(),
  name: z.string().trim().min(1, 'Name darf nicht leer sein.'),
  adminEmail: z.string().trim().email('Bitte eine gültige E-Mail angeben.'),
  primaryColor: z.string().trim().regex(HEX_COLOR_REGEX, 'Primärfarbe muss #RGB oder #RRGGBB sein.'),
  plan: z.enum(['free', 'small', 'big']),
});
