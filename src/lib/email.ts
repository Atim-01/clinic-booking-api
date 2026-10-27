/**
 * Validate email format.
 * Rules: trimmed, one @, domain contains a dot
 */
export function isValidEmail(email: string): boolean {
  if (!email || typeof email !== 'string') {
    return false;
  }

  const trimmed = email.trim();
  
  // Must have exactly one @
  const atCount = (trimmed.match(/@/g) || []).length;
  if (atCount !== 1) {
    return false;
  }

  const [local, domain] = trimmed.split('@');
  
  // Both parts must exist
  if (!local || !domain) {
    return false;
  }

  // Domain must contain a dot
  if (!domain.includes('.')) {
    return false;
  }

  return true;
}

/**
 * Normalize email: trim and lowercase
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
