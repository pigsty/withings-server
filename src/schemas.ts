import { z } from "zod";

export type SessionRecord = {
  sessionId: string;
  macAddress?: string;
  auth?: string;
  mfgId?: string;
  hash?: string;
  currentFw?: number;
  batteryLevel?: number;
  duration?: number;
  zreboot?: number;
  createdAt: number;
};

export const onceBodySchema = z.object({
  action: z.string().optional()
});

export const newSessionSchema = z.object({
  action: z.literal("new"),
  macaddress: z.string().optional(),
  auth: z.string().optional(),
  mfgid: z.string().optional(),
  hash: z.string().optional(),
  currentfw: z.coerce.number().optional(),
  batterylvl: z.coerce.number().optional(),
  duration: z.coerce.number().optional(),
  zreboot: z.coerce.number().optional()
});

export const deleteSessionSchema = z.object({
  action: z.literal("delete"),
  sessionid: z.string().min(1)
});

export const storeMeasureSchema = z.object({
  action: z.literal("store"),
  sessionid: z.string().min(1),
  macaddress: z.string().optional(),
  userid: z.coerce.number().optional(),
  meastime: z.coerce.number().optional(),
  devtype: z.coerce.number().optional(),
  attribstatus: z.coerce.number().optional(),
  measures: z.string().min(1)
});

export const userMeasurementsQuerySchema = z.object({
  start: z.coerce.number().int(),
  end: z.coerce.number().int(),
  granularity: z.enum(["raw", "daily", "weekly"]).optional().default("raw")
});

export const createUiUserSchema = z.object({
  screenName: z.string().trim().min(1).max(64)
});

export const updateUiUserSchema = z.object({
  screenName: z.string().trim().min(1).max(64),
  externalUserId: z.coerce.number().int().positive().nullable(),
  profileWeightKg: z.coerce.number().positive().nullable(),
  profileHeightM: z.coerce.number().positive().nullable(),
  profileAgeYears: z.coerce.number().positive().nullable(),
  profileSex: z.coerce.number().int().min(0).max(1).nullable()
});
