/** The one password rule, used when setting up the server, joining, and changing a password (server and screen alike). */

export const MIN_PASSWORD = 12;
export const PASSWORD_RULE = "Choose a password of at least 12 characters that isn't your email and doesn't include your name.";

/** What is wrong with a new password, or '' when it is fine. Names count by their words of three letters or more. */
export function passwordProblem(pw: string, email?: string | null, name?: string | null) {
  const p = String(pw || '');
  const low = p.toLowerCase();
  if (p.length < MIN_PASSWORD) return PASSWORD_RULE;
  if (email && low === String(email).trim().toLowerCase()) return PASSWORD_RULE;
  const words = String(name || '').toLowerCase().split(/[^\p{L}]+/u).filter((w) => w.length >= 3);
  if (words.some((w) => low.includes(w))) return PASSWORD_RULE;
  return '';
}
