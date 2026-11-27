import { describe, expect, it } from "vitest";
import en from "../../mobile/src/i18n/locales/en.json";

describe("mobile school dictionary coverage", () => {
  it("contains migrated school screen strings", () => {
    expect(en.school.tabs).toMatchObject({
      home: "Home",
      results: "Results",
      attendance: "Attendance",
      fees: "Fees",
      messages: "Messages",
      cbt: "CBT",
    });

    expect(en.school.home).toMatchObject({
      welcome: "Welcome",
      platformConsoleTitle: "Platform console",
      platformConsoleSubtitle: "Organization, missions, evidence",
      signOut: "Sign out",
    });

    expect(en.school.results.empty).toBe("No published results yet.");
    expect(en.school.fees).toMatchObject({
      empty: "No fees on record.",
      outstanding: "Outstanding",
      payOnWeb: "Pay securely on the web",
    });
    expect(en.school.messages).toMatchObject({
      empty: "No messages.",
      noSubject: "(no subject)",
    });
    expect(en.school.cbt).toMatchObject({
      cannotStart: "Could not start the test",
      submit: "Submit",
      empty: "No open tests for your class.",
    });
    expect(en.school.attendance.empty).toBe("No attendance recorded in the last 60 days.");
  });
});
