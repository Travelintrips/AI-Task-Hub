// DEV-only transport-independent wake signalling for Android workers.
// The push contains no job payload, credentials, or capability grants.
import crypto from 'node:crypto';

export function makeAndroidWakeSender({ sendPush, now = Date.now, dedupeMs = 60_000 }) {
  if (typeof sendPush !== 'function') throw new TypeError('sendPush required');
  const seen = new Map();
  return async function wake({ deviceId, jobId, token }) {
    if (!/^[-a-zA-Z0-9_:]{4,120}$/.test(deviceId ?? '')) throw new Error('invalid_device_id');
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(jobId ?? '')) throw new Error('invalid_job_id');
    if (typeof token !== 'string' || token.length < 16) throw new Error('invalid_push_token');
    const instant = now();
    for (const [key, expiresAt] of seen) if (expiresAt <= instant) seen.delete(key);
    const key = crypto.createHash('sha256').update(deviceId + '\0' + jobId).digest('hex');
    if ((seen.get(key) ?? 0) > instant) return { sent: false, deduplicated: true };
    // Only the opaque job identifier is sent; device must authenticate to claim it.
    // A send failure must not suppress a retry.
    await sendPush({ token, data: { type: 'android_job_available', jobId }, priority: 'high' });
    seen.set(key, instant + dedupeMs);
    return { sent: true, deduplicated: false };
  };
}
