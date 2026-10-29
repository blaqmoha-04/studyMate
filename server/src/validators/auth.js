import { z } from 'zod';
import { emailField, passwordField, timezoneField, nameField } from './common.js';

export const registerBody = z.object({
  email: emailField, name: nameField, password: passwordField,
  timezone: timezoneField.optional(),
  // Terms acceptance is explicit and the server enforces it, not just the form.
  acceptTerms: z.literal(true, { error: 'You must accept the Terms of Service to create an account' }),
}).strict();
export const loginBody = z.object({ email: emailField, password: z.string().min(1).max(128) }).strict();
export const forgotBody = z.object({ email: emailField }).strict();
export const resetBody = z.object({ token: z.string().min(20).max(200), password: passwordField }).strict();
export const changePasswordBody = z.object({
  currentPassword: z.string().min(1).max(128), newPassword: passwordField,
}).strict();
