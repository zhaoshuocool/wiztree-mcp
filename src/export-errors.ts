// WizTree can exit 0 while writing nothing but the CSV header, most often when a GUI
// instance already holds the index. The parser throws this so the Windows scan can tell
// "the exporter produced no rows" from "the CSV is unreadable" and retry the former.
export class EmptyWizTreeExportError extends Error {
  readonly csvPath: string;

  constructor(csvPath: string) {
    super(`CSV ${csvPath} matched the header but yielded no rows; WizTree may have exported nothing.`);
    this.name = "EmptyWizTreeExportError";
    this.csvPath = csvPath;
  }
}
