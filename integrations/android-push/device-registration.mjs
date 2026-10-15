// DEV-only authorization and validation of Android push token registration.
// Does not write the device registry or expose an HTTP endpoint.
// Call only after a pairing-authenticated request; never log the credential/token.
import crypto from 'node:crypto';

export function authorizeDevicePushRegistration({ deviceId, credential, pushToken, registry }) {
  if (!/^[a-zA-Z0-9_-]{3,48}$/.test(deviceId ?? '')) throw Error('invalid_device_id');
  if (typeof credential !== 'string' || credential.length < 16) throw Error('invalid_device_credential');
  if (typeof pushToken !== 'string' || pushToken.length < 20 || pushToken.length > 4096 ||
      !/^[A-Za-z0-9_:\-]+$/.test(pushToken)) throw Error('invalid_push_token');
  const device = registry?.[deviceId];
  if (device?.active !== true || !/^[0-9a-f]{64}$/i.test(device.hash ?? '')) throw Error('device_not_authorized');
  const actual = crypto.createHash('sha256').update(credential).digest();
  const expected = Buffer.from(device.hash, 'hex');
  if (!crypto.timingSafeEqual(actual, expected)) throw Error('device_not_authorized');
  return { deviceId, pushToken, registeredAt: new Date().toISOString() };
}
