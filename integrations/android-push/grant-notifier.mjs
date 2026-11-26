// DEV-only bridge between granted jobs and an injected push delivery function.
// No push token means no delivery attempt; the job stays queued for normal claim.
import { makeAndroidWakeSender } from './wake.mjs';

export function makeGrantedJobNotifier({ sendPush, now = Date.now, dedupeMs = 60_000 }) {
  const wake = makeAndroidWakeSender({ sendPush, now, dedupeMs });
  return async function notify({ rows, registry, grants }) {
    const stats = { eligible: 0, sent: 0, deduplicated: 0, missingToken: 0, failed: 0 };
    for (const row of rows) {
      if (row.source !== 'OPENCLAW' || row.status !== 'QUEUED' ||
          !/^android-dev:[a-zA-Z0-9_-]{3,48}$/.test(row.source_session_id ?? '')) continue;
      const deviceId = row.source_session_id.slice('android-dev:'.length);
      const device = registry[deviceId], grant = grants[row.id];
      if (device?.active !== true || grant?.active !== true ||
          grant?.deviceId !== deviceId || !(grant.expiresAt > now())) continue;
      stats.eligible++;
      if (!device.pushToken) { stats.missingToken++; continue; }
      try {
        const result = await wake({ deviceId, jobId: row.id, token: device.pushToken });
        if (result.sent) stats.sent++; else stats.deduplicated++;
      } catch { stats.failed++; }
    }
    return stats;
  };
}
