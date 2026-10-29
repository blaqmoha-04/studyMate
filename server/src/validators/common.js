import { z } from 'zod';

export const isValidTimezone = (tz) => {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
};

export const emailField = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address').max(254));
export const passwordField = z.string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be at most 128 characters')
  .refine((p) => new Set(p).size > 3, 'Password is too repetitive');
export const timezoneField = z.string().trim().max(64).refine(isValidTimezone, 'Unknown time zone');
export const nameField = z.string().trim().min(1, 'Name is required').max(100);
export const uuidParam = z.object({ id: z.uuid('Invalid id') });

export const isoDate = z.string().datetime({ offset: true, message: 'Must be an ISO 8601 date-time with time zone' })
  .transform((s) => new Date(s))
  .refine((d) => d.getUTCFullYear() >= 2000 && d.getUTCFullYear() <= 2100, 'Date is out of the supported range');

export const pagination = {
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
};
