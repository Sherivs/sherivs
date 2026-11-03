import { jsPDF } from "jspdf";

export type MobilityDocumentKind = "transfer-certificate" | "movement-record";

export type MobilityDocumentStudent = {
  fullName: string;
  admissionNumber: string | null;
};

export type MobilityDocumentPlacement = {
  className: string;
  movementType: string;
  reason: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  session: string | null;
};

function documentDate(value: string | null): string {
  if (!value) return "Current";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not recorded" : date.toISOString().slice(0, 10);
}

export function mobilityDocumentLines(
  kind: MobilityDocumentKind,
  student: MobilityDocumentStudent,
  placements: readonly MobilityDocumentPlacement[],
): string[] {
  return [
    kind === "transfer-certificate" ? "Transfer certificate" : "Student movement record",
    `Student: ${student.fullName}`,
    `Admission number: ${student.admissionNumber || "Not recorded"}`,
    "Recorded placement history:",
    ...placements.map(
      (placement) =>
        `${documentDate(placement.effectiveFrom)} to ${documentDate(placement.effectiveTo)} — ${placement.className}; ${placement.movementType}; session ${placement.session || "not recorded"}; ${placement.reason}`,
    ),
    "Institution-generated record. Review and complete any required institutional authorization before issue.",
  ];
}

export function downloadMobilityDocument(
  kind: MobilityDocumentKind,
  student: MobilityDocumentStudent,
  placements: readonly MobilityDocumentPlacement[],
): void {
  const pdf = new jsPDF();
  const lines = mobilityDocumentLines(kind, student, placements);
  let y = 22;
  for (const [index, line] of lines.entries()) {
    const wrapped = pdf.splitTextToSize(line, 170);
    if (index === 0) pdf.setFontSize(18);
    else pdf.setFontSize(10);
    if (y + wrapped.length * 6 > 280) {
      pdf.addPage();
      y = 18;
    }
    pdf.text(wrapped, 20, y);
    y += wrapped.length * 6 + (index === 0 ? 8 : 3);
  }
  pdf.save(`${kind}.pdf`);
}
