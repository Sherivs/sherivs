import { describe, expect, it } from "vitest";
import { isAcceptableVoicePin } from "../../../frontend/src/lib/communications/voice-pin";

describe("voice PIN rules", () => {
  it("accepts a 6 to 8 digit PIN that is not a simple pattern", () => {
    expect(isAcceptableVoicePin("135790")).toBe(true);
    expect(isAcceptableVoicePin("582913")).toBe(true);
    expect(isAcceptableVoicePin("1357902")).toBe(true);
    expect(isAcceptableVoicePin("13579024")).toBe(true);
  });

  it("rejects short, repeated, running, denied, and year PINs", () => {
    expect(isAcceptableVoicePin("13579")).toBe(false);
    expect(isAcceptableVoicePin("135790246")).toBe(false);
    expect(isAcceptableVoicePin("111111")).toBe(false);
    expect(isAcceptableVoicePin("000000")).toBe(false);
    expect(isAcceptableVoicePin("123456")).toBe(false);
    expect(isAcceptableVoicePin("12345678")).toBe(false);
    expect(isAcceptableVoicePin("654321")).toBe(false);
    expect(isAcceptableVoicePin("98765432")).toBe(false);
    for (const denied of ["0000", "1111", "1234", "1212", "2580", "6969", "1004", "2000"]) {
      expect(isAcceptableVoicePin(denied)).toBe(false);
    }
    expect(isAcceptableVoicePin("1950")).toBe(false);
    expect(isAcceptableVoicePin("2026")).toBe(false);
    expect(isAcceptableVoicePin("2030")).toBe(false);
    expect(isAcceptableVoicePin("1949")).toBe(false);
  });
});
