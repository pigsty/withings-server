import express, { type Request, type Response } from "express";
import { type Logger } from "pino";
import { z } from "zod";
import { type WithingsDataAccess, type NormalizedMeasure } from "../data/withingsDataAccess.js";
import { sendScaleJson, parseMeasures, measuresPayloadSchema } from "../scale-utils.js";
import {
  type SessionRecord,
  onceBodySchema,
  newSessionSchema,
  deleteSessionSchema,
  storeMeasureSchema
} from "../schemas.js";
import {
  nowUnix,
  generateSessionId,
  measurementTypeLabel,
  normalizeValue,
  toScaleShortName
} from "../utils.js";

type ScaleRouterDeps = {
  logger: Logger;
  dataAccess: WithingsDataAccess;
  sessions: Map<string, SessionRecord>;
  serverHeader: string;
  onceToken: string;
  profileDefaults: { userId: number; screenName: string };
  dbPath: string;
};

export function createScaleRouter(deps: ScaleRouterDeps): express.Router {
  const { logger, dataAccess, sessions, serverHeader, onceToken, profileDefaults, dbPath } = deps;
  const router = express.Router();

  router.post("/once", (req: Request, res: Response) => {
    const body = onceBodySchema.parse(req.body ?? {});

    logger.info(
      {
        endpoint: "/cgi-bin/once",
        remoteAddress: req.ip,
        headers: req.headers,
        body
      },
      "withings once request"
    );

    sendScaleJson(res, serverHeader, {
      status: 0,
      body: { once: onceToken }
    });
  });

  router.post("/session", (req: Request, res: Response) => {
    const action = String((req.body?.action as string | undefined) ?? "");

    logger.info(
      {
        endpoint: "/cgi-bin/session",
        remoteAddress: req.ip,
        headers: req.headers,
        body: req.body
      },
      "withings session request"
    );

    if (action === "new") {
      const parsed = newSessionSchema.parse(req.body ?? {});
      const sessionId = generateSessionId();
      const createdAt = nowUnix();
      const registeredUsers = dataAccess.listUsers();
      const sessionUsers =
        registeredUsers.length > 0
          ? registeredUsers.map((user) => {
              const profile = dataAccess.getScaleProfileByRowId(user.userId);
              const recentStats = dataAccess.getRecentMeasurementStats(user.userId, 5);

              return {
                id: user.externalUserId ?? user.userId,
                sn: toScaleShortName(profile.screenName),
                wt: recentStats.avgWeightKg || profile.weightKg || 70,
                re: recentStats.avgRe ?? 400,
                ri: recentStats.avgRi ?? 2000,
                ht: profile.heightM ?? 1.7,
                agt: profile.ageYears ?? 40,
                sx: profile.sex ?? 1,
                fm: 1,
                cr: createdAt,
                att: 0
              };
            })
          : [
              {
                id: profileDefaults.userId,
                sn: toScaleShortName(profileDefaults.screenName),
                wt: 70,
                re: 400,
                ri: 2000,
                ht: 1.7,
                agt: 40,
                sx: 1,
                fm: 1,
                cr: createdAt,
                att: 0
              }
            ];

      sessions.set(sessionId, {
        sessionId,
        macAddress: parsed.macaddress ?? parsed.auth,
        auth: parsed.auth,
        mfgId: parsed.mfgid,
        hash: parsed.hash,
        currentFw: parsed.currentfw,
        batteryLevel: parsed.batterylvl,
        duration: parsed.duration,
        zreboot: parsed.zreboot,
        createdAt
      });

      logger.info(
        { sessionId, totalActiveSessions: sessions.size, handshake: parsed },
        "withings session created"
      );

      sendScaleJson(res, serverHeader, {
        status: 0,
        body: {
          sessionid: sessionId,
          sp: {
            users: sessionUsers
          },
          ind: {
            lg: process.env.WITHINGS_LANG ?? "en_GB",
            imt: 1,
            stp: 0,
            f: 0,
            g: Number(process.env.WITHINGS_G ?? 97973)
          },
          syp: { utc: nowUnix() },
          ctp: {
            goff: Number(process.env.WITHINGS_GOFF ?? 0),
            dst: Number(process.env.WITHINGS_DST ?? 0),
            ngoff: Number(process.env.WITHINGS_NGOFF ?? 0)
          }
        }
      });

      return;
    }

    if (action === "delete") {
      const parsed = deleteSessionSchema.parse(req.body ?? {});
      const existed = sessions.delete(parsed.sessionid);

      logger.info(
        { sessionId: parsed.sessionid, existed, totalActiveSessions: sessions.size },
        "withings session deleted"
      );

      sendScaleJson(res, serverHeader, { status: 0 });
      return;
    }

    logger.info({ action, body: req.body }, "withings session action not recognized");
    sendScaleJson(res, serverHeader, { status: 255 });
  });

  router.post("/measure", (req: Request, res: Response) => {
    const parsed = storeMeasureSchema.parse(req.body ?? {});
    const decodedMeasures = parseMeasures(parsed.measures);
    const session = sessions.get(parsed.sessionid);
    const sessionKnown = Boolean(session);
    const batteryLevel = session?.batteryLevel;

    const normalizedMeasures: NormalizedMeasure[] = decodedMeasures.measures.map(
      (m: z.infer<typeof measuresPayloadSchema>["measures"][number]) => ({
        ...m,
        normalizedValue: normalizeValue(m.value, m.unit),
        label: measurementTypeLabel(m.type)
      })
    );

    const extracted = dataAccess.extractScaleData(normalizedMeasures);
    const measuredAt = parsed.meastime ?? nowUnix();
    const receivedAt = nowUnix();
    const { measurementId, userAssignment } = dataAccess.persistMeasurement({
      sessionId: parsed.sessionid,
      macAddress: parsed.macaddress,
      scaleUserId: parsed.userid,
      batteryLevel,
      measuredAt,
      receivedAt,
      devType: parsed.devtype,
      attribStatus: parsed.attribstatus,
      rawMeasuresJson: parsed.measures,
      normalizedMeasures,
      extracted
    });

    logger.info(
      {
        endpoint: "/cgi-bin/measure",
        remoteAddress: req.ip,
        headers: req.headers,
        envelope: {
          sessionid: parsed.sessionid,
          macaddress: parsed.macaddress,
          userid: parsed.userid,
          meastime: parsed.meastime,
          devtype: parsed.devtype,
          attribstatus: parsed.attribstatus,
          sessionKnown,
          batteryLevel
        },
        db: {
          path: dbPath,
          measurementId,
          userId: userAssignment.userId,
          assignment: userAssignment.strategy,
          deltaKg: userAssignment.deltaKg
        },
        extracted,
        measuresRaw: parsed.measures,
        measuresDecoded: normalizedMeasures
      },
      "withings measure store"
    );

    sendScaleJson(res, serverHeader, { status: 0 });
  });

  return router;
}
