import 'server-only';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

// Database errors -> words an owner understands. Raw errors stay in the server log.
const MESSAGES = {
  BUSINESS_LIMIT_REACHED: 'You can own up to 3 salons.',
  '23P01': 'That overlaps a time that is already set.',
  '23505': 'That already exists.',
  '23514': 'Some values are out of range. Please check them.',
  '23503': 'It is still used by bookings, so it can’t be deleted. Turn it off instead.',
  '42501': 'You don’t have permission to change this.',
  APPOINTMENT_NOT_STARTED: 'That appointment hasn’t started yet.',
};

// Ends a Server Action: back to `path`, with an error banner if something failed
// (or an optional success note). Revalidating first drops the browser's cached
// copies of pages built from old data.
export function done(path, error, ok) {
  revalidatePath('/', 'layout');
  const join = path.includes('?') ? '&' : '?';
  if (!error) redirect(ok ? `${path}${join}ok=${encodeURIComponent(ok)}` : path);
  const msg = typeof error === 'string' ? error
    : MESSAGES[error.message] ?? MESSAGES[error.code] ?? 'Something went wrong. Please try again.';
  if (typeof error !== 'string') console.error(error);
  redirect(`${path}${join}error=${encodeURIComponent(msg)}`);
}

// First Zod issue as a sentence.
export const firstIssue = (result) => result.error.issues[0]?.message ?? 'Please check the form.';
