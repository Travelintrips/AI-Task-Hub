import { registerChatgptConversation } from "./register-chatgpt-conversation.mjs";

/**
 * DEV-only handoff: the browser worker supplies a verified receipt, and the
 * signed-in AI Task user supplies their own JWT through an authenticated flow.
 * Neither AI Core scoped tokens nor synthetic user identities are accepted.
 */
export async function registerVerifiedChatgptReceipt({ receipt, expectedConversationId, aiTaskSession, relaySecret, baseUrl }) {
  if (!receipt || receipt.verifiedAssistantReply !== true ||
      receipt.conversationId !== expectedConversationId ||
      !/^[a-f0-9]{64}$/.test(String(receipt.evidenceFingerprint || "")) ||
      !receipt.verifiedAt || Number.isNaN(Date.parse(receipt.verifiedAt))) {
    throw new Error("Verified ChatGPT browser receipt required");
  }
  if (!/^[A-Za-z0-9-]{30,64}$/.test(String(expectedConversationId || ""))) {
    throw new Error("Invalid expected browser conversation");
  }
  if (!aiTaskSession || !aiTaskSession.userJwt || !Number.isSafeInteger(aiTaskSession.userId) ||
      !aiTaskSession.companyId) {
    throw new Error("Authenticated AI Task user session required");
  }
  return registerChatgptConversation({
    sourceConversationId: expectedConversationId,
    userJwt: aiTaskSession.userJwt,
    userId: aiTaskSession.userId,
    companyId: aiTaskSession.companyId,
    secret: relaySecret,
    baseUrl,
  });
}
