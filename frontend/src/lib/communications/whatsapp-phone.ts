export function normalizeWhatsAppPhone(value: string): string | null {
  if (!/^[+0-9\s().-]+$/.test(value)) return null;
  const digits = value.replace(/\D/g, "");
  const international =
    digits.startsWith("0") && digits.length === 11 ? `234${digits.slice(1)}` : digits;
  return /^[1-9]\d{7,14}$/.test(international) ? `+${international}` : null;
}
