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
  // Separate verified persisted MCP delivery receipt from final ChatGPT E2E.
  // This evidence may come only through the authenticated AI Core ledger bridge.
  if (source["mcpReceiptPersisted"] === true) {
    const timestamp = source["mcpAckAt"];
    if (typeof timestamp === "string" && timestamp.length <= 35 &&
        Number.isFinite(Date.parse(timestamp)) && !Number.isNaN(Date.parse(timestamp))) {
      result["mcpReceiptPersisted"] = true;
      result["mcpAckAt"] = timestamp;
    }
  }
  if (result["mcpReceiptPersisted"] === true &&
      source["finalE2eVerified"] === true &&
      source["finalE2eMethod"] === "AI_CORE_VERIFIED_MCP_HANDSHAKE_V1" &&
      typeof source["finalE2eVerifiedAt"] === "string" &&
      source["finalE2eVerifiedAt"] === result["mcpAckAt"]) {
    result["finalE2eVerified"] = true;
    result["finalE2eVerifiedAt"] = source["finalE2eVerifiedAt"];
    result["finalE2eMethod"] = "AI_CORE_VERIFIED_MCP_HANDSHAKE_V1";
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
