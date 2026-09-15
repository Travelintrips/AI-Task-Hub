import {
  Router,
  type IRouter,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { findActivePaymentProofShortLink } from "../lib/payment-proof-links";
import {
  isPaymentProofTokenFormat,
  isRootPaymentProofTokenFormat,
} from "../lib/payment-proof-token";
import { supabase } from "../lib/supabase";

const router: IRouter = Router();
const SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60;

async function redirectToPaymentProof(
  token: string,
  req: Request,
  res: Response,
): Promise<void> {
  if (!isPaymentProofTokenFormat(token)) {
    res.status(404).send("Not found");
    return;
  }

  try {
    const link = await findActivePaymentProofShortLink(token);
    if (!link || !supabase) {
      res.status(404).send("Not found");
      return;
    }

    const { data, error } = await supabase.storage
      .from(link.storage_bucket)
      .createSignedUrl(link.storage_path, SIGNED_URL_TTL_SECONDS);

    if (error || !data?.signedUrl) {
      res.status(404).send("Not found");
      return;
    }

    res.redirect(302, data.signedUrl);
  } catch (error) {
    req.log.warn({ err: error }, "payment proof short link lookup failed");
    res.status(404).send("Not found");
  }
}

/**
 * New short links use a single validated 10-character root segment.
 * The anchored RegExp prevents this handler from becoming a generic
 * "/:token" route that can intercept normal frontend paths.
 */
router.get(
  /^\/([A-Za-z0-9_-]{10})$/,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const token = String(req.params[0] ?? "");
    if (!isRootPaymentProofTokenFormat(token)) {
      next();
      return;
    }
    await redirectToPaymentProof(token, req, res);
  },
);

/**
 * Legacy public bearer links remain available under /p/:token.
 */
router.get("/p/:token", async (req: Request, res: Response): Promise<void> => {
  await redirectToPaymentProof(String(req.params.token ?? ""), req, res);
});

export default router;