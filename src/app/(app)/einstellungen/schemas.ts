import { z } from 'zod';

// zod-Schema getrennt von actions.ts: eine 'use server'-Datei darf NUR async Server Actions
// exportieren (sonst scheitert `next build`). Die Unit-Tests (Spec §14) importieren von hier.
export const checkoutSchema = z.enum(['small', 'big']);
