/**
 * COMMS-02 voice PIN rules. The database enforces the same checks.
 * A rejected PIN is never echoed back to the caller.
 */

const DENIED_PINS = new Set(["0000", "1111", "1234", "1212", "2580", "6969", "1004", "2000"]);

export const VOICE_PIN_REJECTION_MESSAGE =
  "Use the same 6 to 8 digit PIN in both fields. Repeated digits, straight runs, and common PINs are not accepted.";

export function voicePinRejectionReason(pin: string): string | null {
  if (!isAcceptableVoicePin(pin)) return VOICE_PIN_REJECTION_MESSAGE;
  return null;
}

export function isAcceptableVoicePin(pin: string): boolean {
  if (!/^[0-9]+$/.test(pin)) return false;
  if (DENIED_PINS.has(pin)) return false;
  if (pin.length === 4) {
    const year = Number(pin);
    if (year >= 1950 && year <= 2030) return false;
  }
  if (pin.length < 6 || pin.length > 8) return false;
  if (/^(\d)\1+$/.test(pin)) return false;
  let ascending = true;
  let descending = true;
  for (let index = 1; index < pin.length; index += 1) {
    const step = Number(pin[index]) - Number(pin[index - 1]);
    if (step !== 1) ascending = false;
    if (step !== -1) descending = false;
  }
  return !ascending && !descending;
}
