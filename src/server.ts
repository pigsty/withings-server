import { WithingsDataAccess } from "./data/withingsDataAccess.js";
import express, { type NextFunction, type Request, type Response } from "express";
import { resolve } from "node:path";
import pino from "pino";
import { nowUnix } from "./utils.js";
import { sendScaleJson } from "./scale-utils.js";
import { type SessionRecord } from "./schemas.js";
import { createScaleRouter } from "./routes/scale.js";
import { createUiRouter } from "./routes/ui.js";

const logger = pino({
  level: process.env.LOG_LEVEL ?? "info"
});

const app = express();
app.disable("x-powered-by");
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use((req: Request, _res: Response, next: NextFunction) => {
  logger.info(
    {
      method: req.method,
      path: req.path,
      remoteAddress: req.ip,
      headers: req.headers
    },
    "incoming request"
  );
  next();
});

const port = Number(process.env.PORT ?? 80);
const onceToken = process.env.WITHINGS_ONCE_TOKEN ?? "21112cb3-1b433eef";
const serverHeader =
  process.env.WITHINGS_SERVER_HEADER ??
  "Apache/2.2.8 (Ubuntu) PHP/5.2.4-2ubuntu5.10 with Suhosin-Patch mod_ssl/2.2.8 OpenSSL/0.9.8g";

const profileDefaults = {
  userId: Number(process.env.WITHINGS_USER_ID ?? 101010),
  screenName: process.env.WITHINGS_SCREEN_NAME ?? "USR"
};

const sessions = new Map<string, SessionRecord>();
const dbPath = process.env.SQLITE_PATH ?? process.env.WITHINGS_SQLITE_PATH ?? "withings.sqlite";
const dataAccess = new WithingsDataAccess(dbPath, nowUnix);
const uiPublicDir = resolve(process.cwd(), "dist/public");

dataAccess.initialize();

app.use(
  "/cgi-bin",
  createScaleRouter({ logger, dataAccess, sessions, serverHeader, onceToken, profileDefaults, dbPath })
);

app.use(createUiRouter({ dataAccess, sessions, dbPath }));

app.use(express.static(uiPublicDir, { index: "index.html" }));

app.get(/^\/(?!api\/|cgi-bin\/|healthz$).*/, (_req: Request, res: Response) => {
  res.sendFile(resolve(uiPublicDir, "index.html"));
});

app.use((err: unknown, _req: Request, res: Response, _next: express.NextFunction) => {
  logger.info({ err }, "request parse/validation error");
  sendScaleJson(res, serverHeader, { status: 255 });
});

app.listen(port, "0.0.0.0", () => {
  logger.info({ port, dbPath }, "withings server listening");
});
