type PreparationReadiness = {
  taskId: number;
  canRequestPreparation: boolean;
  reason: string;
};

type OperatorSession = {
  googleProofFresh: boolean;
  requiresFreshGoogleLogin: boolean;
};

export function preparationAction(
  taskId: number,
  readiness: PreparationReadiness | undefined,
  session: OperatorSession | undefined,
  readFailed: boolean,
) {
  if (readFailed || (readiness && readiness.taskId !== taskId)) return "unavailable";
  if (!readiness) return "checking";
  if (readiness.reason === "GPT02_FRESH_GOOGLE_OPERATOR_REQUIRED") {
    return readiness.canRequestPreparation ? "unavailable" : "sign-in";
  }
  if (!readiness.canRequestPreparation) return "waiting";
  if (!session) return "checking";
  if (session.googleProofFresh && !session.requiresFreshGoogleLogin) return "prepare";
  if (session.requiresFreshGoogleLogin && !session.googleProofFresh) return "sign-in";
  return "unavailable";
}
