import { Router, type IRouter, type Request, type Response } from "express";
import { findActivePaymentProofShortLink } from "../lib/payment-proof-links";
import { isPaymentProofTokenFormat } from "../lib/payment-proof-token";
import { supabase } from "../lib/supabase";

const router: IRouter = Router();
const SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * GET /p/:token
 *
 * Public bearer access for private payment proofs. The database lookup is
 * performed with a token hash, then Supabase creates the signed URL server-side.
 * Invalid, expired, revoked, and missing objects all fail closed.
 */
router.get("/p/:token", async (req: Request, res: Response) => {
  const token = String(req.params.token ?? "");
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
});

export default router;