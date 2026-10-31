import { describe, expect, it } from 'vitest';
import { PASSWORD_RULE, passwordProblem } from './password';

describe('password rule', () => {
  it('needs at least 12 characters', () => {
    expect(passwordProblem('short-pass1', 'alex@folio.local', 'Alex Morgan')).toBe(PASSWORD_RULE);
    expect(passwordProblem('long-enough-pass', 'alex@folio.local', 'Alex Morgan')).toBe('');
  });
  it('cannot be the email', () => {
    expect(passwordProblem('Alex@Folio.local', 'alex@folio.local', 'Sam')).toBe(PASSWORD_RULE);
  });
  it("cannot include the person's name, by any word of three letters or more", () => {
    expect(passwordProblem('i-love-morgan-99', 'a@b.co', 'Alex Morgan')).toBe(PASSWORD_RULE);
    expect(passwordProblem('ALEX-and-friends', 'a@b.co', 'Alex Morgan')).toBe(PASSWORD_RULE);
    expect(passwordProblem('Zoë-was-here-2026', 'a@b.co', 'Zoë Lin')).toBe(PASSWORD_RULE);
    // short words in a name do not block everyday words
    expect(passwordProblem('all-the-small-things', 'a@b.co', 'Al Li')).toBe('');
  });
  it('works without an email or name', () => {
    expect(passwordProblem('long-enough-pass', null, null)).toBe('');
  });
});
