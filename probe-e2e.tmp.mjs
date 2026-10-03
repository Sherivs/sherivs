// Temporary F-13 probe 3 (not committed): seroval body + no auth → expect auth gate error.
import { toJSON } from "seroval";

const base = "http://localhost:8080";
const idFor = (file, fn) =>
  Buffer.from(
    JSON.stringify({ file: `/frontend/src/${file}?tss-serverfn-split`, export: `${fn}_createServerFn_handler` }),
  )
    .toString("base64")
    .replace(/=+$/, "");

const RECORD_ID = idFor("lib/foundation-loop.functions.ts", "recordFoundationLoop");
const res = await fetch(`${base}/_serverFn/${RECORD_ID}`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-tsr-serverFn": "true" },
  body: JSON.stringify(
    toJSON({
      data: {
        realityRef: "00000000-0000-0000-0000-000000000000",
        missionId: "probe",
        version: "probe",
        purpose: "probe",
        authorityRef: "probe",
        contextRef: "probe",
        ownerRef: "probe",
        action: "record-observation",
        idempotencyKey: "probe-idem-0001",
      },
    }),
  ),
});
const text = await res.text();
console.log("status=", res.status, "body_head=", text.slice(0, 220).replace(/\n/g, " "));