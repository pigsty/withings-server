import { type Response } from "express";
import { z } from "zod";

const measuresPayloadSchema = z.object({
  measures: z.array(
    z.object({
      value: z.number(),
      type: z.number(),
      unit: z.number()
    })
  )
});

export function sendScaleJson(
  res: Response,
  serverHeader: string,
  payload: unknown
): void {
  res.status(200);
  res.setHeader("Server", serverHeader);
  res.setHeader("Content-Type", "text/plain");
  res.setHeader("Transfer-Encoding", "chunked");
  res.write(JSON.stringify(payload));
  res.end();
}

export function parseMeasures(raw: string): z.infer<typeof measuresPayloadSchema> {
  const parsed = JSON.parse(raw);
  return measuresPayloadSchema.parse(parsed);
}

export { measuresPayloadSchema };
