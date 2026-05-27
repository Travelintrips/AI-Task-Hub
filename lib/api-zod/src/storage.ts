import { z } from "zod";

export const RequestUploadUrlBody = z.object({
  name: z.string().min(1),
  size: z.number().int().positive(),
  contentType: z.string().min(1),
});
export type RequestUploadUrlBody = z.infer<typeof RequestUploadUrlBody>;

export const RequestUploadUrlResponse = z.object({
  uploadURL: z.string().url(),
  objectPath: z.string(),
  metadata: z.object({
    name: z.string(),
    size: z.number(),
    contentType: z.string(),
  }),
});
export type RequestUploadUrlResponse = z.infer<typeof RequestUploadUrlResponse>;
