  // Explicit keyword match first
  const timeKeyword = text.match(/(?:jam|pukul)\s*(\d{1,2})[:.](\d{2})/);
  const timeKeywordHour = timeKeyword
    ? null
    : text.match(/(?:jam|pukul)\s*(\d{1,2})(?!\d)/);
  // Standalone HH:MM
  const timeStandalone = timeKeyword || timeKeywordHour
    ? null
    : text.match(/\b(\d{1,2})[:.](00|15|30|45)\b/);

  const rawH = timeKeyword?.[1] ?? timeKeywordHour?.[1] ?? timeStandalone?.[1] ?? null;
  const rawM = timeKeyword?.[2] ?? timeStandalone?.[2] ?? "00";
  if (rawH !== null) {
    const hNum = parseInt(rawH, 10);
    if (hNum >= 0 && hNum <= 23) {
      time = `${String(hNum).padStart(2, "0")}:${rawM.padStart(2, "0")}`;
    }