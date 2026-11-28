/** Only describes returned source observations, not registry jobs or proof of execution. */
export type SourceGapCategory = "HANDSHAKE" | "PROTECTED_WAKE" | "PASSIVE_EVENT" | "OTHER_COMMAND";
type Observation = { category: string; sourceAckRecorded: boolean };
export function summarizeSourceGap(total: number, rows: readonly Observation[]) {
  if (!Number.isSafeInteger(total) || total < 0 || rows.length > total || rows.length > 100 ||
      (rows.length < 100 && rows.length !== total)) return null;
  const counts = { HANDSHAKE: 0, PROTECTED_WAKE: 0, PASSIVE_EVENT: 0, OTHER_COMMAND: 0 };
  let ackRecorded = 0;
  for (const row of rows) {
    if (!Object.prototype.hasOwnProperty.call(counts, row.category) || typeof row.sourceAckRecorded !== "boolean") return null;
    counts[row.category as SourceGapCategory]++;
    if (row.sourceAckRecorded) ackRecorded++;
  }
  return { counts, observed: rows.length, complete: rows.length === total, ackRecorded, ackNotRecorded: rows.length - ackRecorded };
}
