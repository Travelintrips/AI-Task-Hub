import { createHmac, randomBytes } from 'node:crypto';

// DEV-only relay adapter. Identity and JWT must come from an authenticated upstream.
export async function registerChatgptConversation({ sourceConversationId, userJwt, userId, companyId, secret, baseUrl = 'http://127.0.0.1:18181' }) {
  if (!/^[A-Za-z0-9_-]{6,160}$/.test(sourceConversationId || '')) throw new Error('Invalid verified conversation ID');
  if (!userJwt || !userId || !companyId || !secret || Buffer.byteLength(secret) < 32) throw new Error('Missing authenticated relay credentials');
  const url = new URL(baseUrl);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.protocol !== 'http:') throw new Error('DEV loopback only');
  const timestamp = String(Date.now());
  const nonce = randomBytes(24).toString('base64url');
  const payload = [timestamp, 'chatgpt', sourceConversationId, String(userId), String(companyId), nonce].join('\n');
  const signature = createHmac('sha256', secret).update(payload).digest('hex');
  const response = await fetch(new URL('/api/chatgpt/conversations/register', url), {
    method: 'POST',
    headers: { authorization: `Bearer ${userJwt}`, 'content-type': 'application/json', 'x-chat-relay-timestamp': timestamp, 'x-chat-relay-nonce': nonce, 'x-chat-relay-signature': signature },
    body: JSON.stringify({ command: '#', sourceConversationId }),
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json().catch(() => ({ ok: false, code: 'INVALID_RESPONSE' }));
  if (!response.ok || result.ok !== true || result.ack !== true) throw new Error(`Registration rejected: HTTP ${response.status} ${result.code || ''}`);
  return { ack: true, registrationId: result.registrationId, conversationId: result.conversationId, created: result.created };
}
