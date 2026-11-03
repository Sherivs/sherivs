export type BulkMobilityItem = {
  student_id: string;
  target_class_id: string;
  movement_type: string;
  reason: string;
};

export function bulkMobilityFingerprint(items: readonly BulkMobilityItem[], effectiveDate: string) {
  return JSON.stringify({ items, effectiveDate });
}

export function bulkMobilityPreviewIsCurrent(
  expectedStudentIds: readonly string[],
  previewStudentIds: readonly string[],
  expectedFingerprint: string,
  currentFingerprint: string,
): boolean {
  return (
    expectedFingerprint === currentFingerprint &&
    expectedStudentIds.length > 0 &&
    expectedStudentIds.length === previewStudentIds.length &&
    new Set(previewStudentIds).size === previewStudentIds.length &&
    expectedStudentIds.every((studentId, index) => previewStudentIds[index] === studentId)
  );
}
