export type PasswordScore = 0 | 1 | 2 | 3 | 4;

export const PASSWORD_SCORE_LABEL: Record<PasswordScore, string> = {
  0: 'Very weak',
  1: 'Weak',
  2: 'Fair',
  3: 'Good',
  4: 'Strong',
};

// A handful of the passwords that show up at the top of every breach
// dump - not a real deny-list, just enough to catch the most common
// "this passes the length check but everyone's guessed it" case.
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', '12345678', '123456789', '1234567890',
  'qwerty123', 'qwertyuiop', 'letmein11', 'welcome1', 'iloveyou1', 'admin1234',
  'abc123456', 'monkey123', 'football1', 'dragon123', 'sunshine1', 'princess1',
  'trustno1', 'baseball1', '87654321', 'starwars1', 'superman1', 'whatever1',
]);

/**
 * A length-and-character-variety heuristic, not real entropy estimation
 * (no zxcvbn-style dictionary/pattern analysis) - good enough to nudge
 * someone away from "password1" without pulling in a scoring library for
 * one form field.
 */
export function scorePassword(password: string): PasswordScore {
  if (!password) return 0;
  if (COMMON_PASSWORDS.has(password.toLowerCase())) return 0;

  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;

  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (classes >= 3) score++;
  if (classes >= 4) score++;

  return Math.min(score, 4) as PasswordScore;
}
