// Server-side DEV-only Firebase Cloud Messaging adapter.
// Inject google-auth-library token provider and fetch, avoiding client credentials in source.
export function makeFcmSender({ projectId, getAccessToken, fetchImpl = fetch }) {
  if (!/^[a-z][a-z0-9-]{4,62}$/.test(projectId ?? '')) throw Error('invalid_project_id');
  if (typeof getAccessToken !== 'function') throw Error('getAccessToken_required');
  if (typeof fetchImpl !== 'function') throw Error('fetch_required');
  return async ({ token, data, priority }) => {
    if (typeof token !== 'string' || token.length < 16) throw Error('invalid_device_token');
    if (data?.type !== 'android_job_available' || !/^[0-9a-f-]{36}$/i.test(data?.jobId ?? '')) throw Error('invalid_push_payload');
    const accessToken = await getAccessToken();
    if (typeof accessToken !== 'string' || accessToken.length < 16) throw Error('invalid_fcm_access_token');
    const response = await fetchImpl('https://fcm.googleapis.com/v1/projects/' + projectId + '/messages:send', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { token, data, android: { priority: priority === 'high' ? 'HIGH' : 'NORMAL', ttl: '60s' } } }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      // No tokens, message bodies, or authentication headers in logs/errors.
      const error = new Error('fcm_delivery_failed');
      error.status = response.status;
      throw error;
    }
    return { acceptedByFcm: true }; // NOT device receipt, job completion or ACK.
  };
}
