// Password strength rules. Keep in sync with backend/app/schemas/auth.py
// (RegisterIn._strong_password).
export const PASSWORD_RULES = [
  { id: 'length', label: 'At least 8 characters', test: (p) => p.length >= 8 },
  { id: 'upper', label: 'One capital letter (A–Z)', test: (p) => /[A-Z]/.test(p) },
  { id: 'number', label: 'One number (0–9)', test: (p) => /[0-9]/.test(p) },
  { id: 'special', label: 'One special character (e.g. ! @ # $ %)', test: (p) => /[^A-Za-z0-9\s]/.test(p) },
]

export function passwordProblems(password = '') {
  return PASSWORD_RULES.filter((r) => !r.test(password)).map((r) => r.label)
}

export const isStrongPassword = (password) => passwordProblems(password).length === 0
