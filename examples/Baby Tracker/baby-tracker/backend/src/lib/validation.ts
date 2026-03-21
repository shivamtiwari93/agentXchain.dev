const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email);
}

export function assertPassword(password: string): void {
  if (password.length < 8) {
    const err = new Error("Password must be at least 8 characters");
    (err as Error & { status?: number }).status = 400;
    throw err;
  }
}

export function parseISODateOnly(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const err = new Error("date_of_birth must be YYYY-MM-DD");
    (err as Error & { status?: number }).status = 400;
    throw err;
  }
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) {
    const err = new Error("Invalid date_of_birth");
    (err as Error & { status?: number }).status = 400;
    throw err;
  }
  const today = new Date();
  today.setUTCHours(23, 59, 59, 999);
  if (d.getTime() > today.getTime()) {
    const err = new Error("date_of_birth cannot be in the future");
    (err as Error & { status?: number }).status = 400;
    throw err;
  }
  return value;
}
