import express, { type Request, type Response } from "express";
import { z } from "zod";
import { type WithingsDataAccess } from "../data/withingsDataAccess.js";
import {
  userMeasurementsQuerySchema,
  createUiUserSchema,
  updateUiUserSchema
} from "../schemas.js";

type UiRouterDeps = {
  dataAccess: WithingsDataAccess;
  sessions: Map<string, unknown>;
  dbPath: string;
};

export function createUiRouter(deps: UiRouterDeps): express.Router {
  const { dataAccess, sessions, dbPath } = deps;
  const router = express.Router();

  router.get("/healthz", (_req: Request, res: Response) => {
    const counts = dataAccess.getCounts();

    res.status(200).json({
      ok: true,
      activeSessions: sessions.size,
      dbPath,
      users: counts.users,
      measurements: counts.measurements,
      unlinkedMeasurements: dataAccess.countUnlinkedMeasurements()
    });
  });

  router.get("/api/ui/unlinked", (_req: Request, res: Response) => {
    res.status(200).json({
      measurements: dataAccess.listUnlinkedMeasurements()
    });
  });

  router.post("/api/ui/unlinked/:measurementId/assign", (req: Request, res: Response) => {
    const measurementId = z.coerce.number().int().positive().parse(req.params.measurementId);
    const body = z.object({ userId: z.coerce.number().int().positive() }).parse(req.body ?? {});
    const ok = dataAccess.reassignMeasurement(measurementId, body.userId);
    if (!ok) {
      res.status(404).json({ error: "measurement or user not found" });
      return;
    }
    res.status(200).json({ ok: true });
  });

  router.post("/api/ui/measurements/:measurementId/unlink", (req: Request, res: Response) => {
    const measurementId = z.coerce.number().int().positive().parse(req.params.measurementId);
    const ok = dataAccess.unlinkMeasurement(measurementId);
    if (!ok) {
      res.status(404).json({ error: "measurement not found or already unlinked" });
      return;
    }
    res.status(200).json({ ok: true });
  });

  router.get("/api/ui/users", (_req: Request, res: Response) => {
    res.status(200).json({
      users: dataAccess.listUsers()
    });
  });

  router.post("/api/ui/users", (req: Request, res: Response) => {
    const body = createUiUserSchema.parse(req.body ?? {});
    const userId = dataAccess.createUiUser(body.screenName);
    res.status(201).json({ userId });
  });

  router.put("/api/ui/users/:userId", (req: Request, res: Response) => {
    const userId = z.coerce.number().int().positive().parse(req.params.userId);
    const body = updateUiUserSchema.parse(req.body ?? {});

    try {
      const ok = dataAccess.updateUserProfile(userId, body);
      if (!ok) {
        res.status(404).json({ error: "user not found" });
        return;
      }
    } catch {
      res.status(409).json({ error: "could not update user" });
      return;
    }

    res.status(200).json({ ok: true });
  });

  router.get("/api/ui/users/:userId/measurements", (req: Request, res: Response) => {
    const userId = z.coerce.number().int().positive().parse(req.params.userId);
    const query = userMeasurementsQuerySchema.parse(req.query);

    res.status(200).json({
      measurements: dataAccess.listMeasurementsForUser(userId, query.start, query.end, query.granularity)
    });
  });

  return router;
}
