import { useState } from "react";
import { exportAscFile } from "@/lib/runtime/scholar/asc-export.functions";

function saveDownload(fileName: string, format: "csv" | "xlsx", content: string): void {
  const mimeType =
    format === "csv"
      ? "text/csv;charset=utf-8"
      : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const blobContent =
    format === "csv"
      ? content
      : Uint8Array.from(atob(content), (character) => character.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([blobContent], { type: mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function AscExportScreen() {
  const [downloading, setDownloading] = useState<"csv" | "xlsx" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function download(format: "csv" | "xlsx") {
    setDownloading(format);
    setError(null);
    try {
      const file = await exportAscFile({ data: { format } });
      saveDownload(file.fileName, format, file.content);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Export failed");
    } finally {
      setDownloading(null);
    }
  }

  return (
    <section className="app-shell-section" data-testid="asc-export-screen">
      <h1>ASC-structured export draft</h1>
      <p role="status">
        This field order is an unverified draft derived from the current schema. It has not been
        checked against an official ASC form; do not use it as an official return.
      </p>
      <p>
        The included learner and teacher counts are current snapshots, not year-specific totals.
      </p>
      <p>
        Downloads are file-only. This does not submit or transmit data to any government system.
      </p>
      <div className="app-shell-actions">
        <button type="button" disabled={downloading !== null} onClick={() => void download("csv")}>
          {downloading === "csv" ? "Preparing CSV…" : "Download CSV"}
        </button>
        <button type="button" disabled={downloading !== null} onClick={() => void download("xlsx")}>
          {downloading === "xlsx" ? "Preparing XLSX…" : "Download XLSX"}
        </button>
      </div>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
