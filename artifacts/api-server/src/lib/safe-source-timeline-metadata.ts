/** Allowlisted, non-secret observability fields from the authenticated AI Core ledger sender. */
export function safeSourceTimelineMetadata(value: unknown) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  const result: Record<string, unknown> = {};
  for (const key of ["jobId", "commandId", "correlationId", "workerId"]) {
    const text = source[key];
    if (typeof text === "string" && text.length > 0 && text.length <= 200) result[key] = text;
  }
  for (const key of ["ackReceived", "callbackObserved"]) {
    if (source[key] === true) result[key] = true;
  }
  const raw = source["sopSnapshot"];
  const sop = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown> : {};
  if (typeof sop["version"] === "string" && sop["version"].length <= 120 &&
      typeof sop["title"] === "string" && sop["title"].length <= 300 && Array.isArray(sop["steps"])) {
    result["sopSnapshot"] = {
      version: sop["version"],
      title: sop["title"],
      steps: sop["steps"].filter((s): s is string => typeof s === "string" && s.length <= 1500).slice(0, 5),
    };
  }
  return result;
}
