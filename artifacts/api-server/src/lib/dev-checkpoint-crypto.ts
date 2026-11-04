import { createPublicKey, verify } from 'node:crypto';

/** Canonical signed receipt, versioned and scoped to one exact AI Core continuation. */
export type DevCheckpointReceipt = {
  version: 1;
  jobId: string;
  commandId: string;
  correlationId: string;
  checkpointId: string;
  sopVersion: string;
  nextStepId: string;
  issuedAt: string;
  signature: string;
};
const id = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/;
export function canonicalDevCheckpointReceipt(r: Omit<DevCheckpointReceipt, 'signature'>): string {
  return ['ai-core-dev-checkpoint/v1',r.jobId,r.commandId,r.correlationId,r.checkpointId,r.sopVersion,r.nextStepId,r.issuedAt].join('\n');
}
export function verifyDevCheckpointReceipt(receipt: DevCheckpointReceipt, publicKeyDerBase64?: string): boolean {
  if (!publicKeyDerBase64 || receipt.version !== 1 ||
    ![receipt.jobId,receipt.commandId,receipt.correlationId,receipt.checkpointId,receipt.sopVersion,receipt.nextStepId].every(s => typeof s === 'string' && id.test(s)) ||
    typeof receipt.issuedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(receipt.issuedAt) ||
    !Number.isFinite(Date.parse(receipt.issuedAt)) || typeof receipt.signature !== 'string') return false;
  try {
    const keyBytes = Buffer.from(publicKeyDerBase64, 'base64');
    const signature = Buffer.from(receipt.signature, 'base64');
    if (keyBytes.toString('base64') !== publicKeyDerBase64 || signature.toString('base64') !== receipt.signature || signature.length !== 64) return false;
    const key = createPublicKey({ key:keyBytes,format:'der',type:'spki' });
    if (key.asymmetricKeyType !== 'ed25519') return false;
    const {signature: _ignored, ...unsigned} = receipt;
    return verify(null,Buffer.from(canonicalDevCheckpointReceipt(unsigned)),key,signature);
  } catch { return false; }
}
