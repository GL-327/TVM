/** Luhn check for mock checkout. Digits never leave this function's caller. */

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

export function luhnOk(number: string): boolean {
  const digits = digitsOnly(number);
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = Number(digits[i]);
    if (!Number.isInteger(n)) return false;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

export function expiryOk(value: string, now = new Date()): boolean {
  const match = value.trim().match(/^(\d{1,2})\s*[\/-]\s*(\d{2}|\d{4})$/);
  if (match === null || match[1] === undefined || match[2] === undefined) return false;
  const month = Number(match[1]);
  if (!Number.isInteger(month) || month < 1 || month > 12) return false;
  let year = Number(match[2]);
  if (year < 100) year += 2000;
  if (year < now.getFullYear()) return false;
  if (year === now.getFullYear() && month < now.getMonth() + 1) return false;
  return true;
}

export function cvcOk(value: string): boolean {
  return /^\d{3,4}$/.test(value.trim());
}

export function lastFour(number: string): string {
  const digits = digitsOnly(number);
  return digits.slice(-4);
}
