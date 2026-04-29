# Withings-Compatible Scale Server (TypeScript)

This project implements a Withings scale-compatible HTTP API endpoint set:

- `POST /cgi-bin/once` with `action=get`
- `POST /cgi-bin/session` with `action=new`
- `POST /cgi-bin/measure` with `action=store`
- `POST /cgi-bin/session` with `action=delete`

The server logs all received handshake and measurement payloads at info level.

Measurements are also persisted to SQLite with automatic user assignment based on recent weight averages.

Inspiration from this page: https://www.prolixium.com/mynews?id=915

## Compatibility Notes

The responses mirror the legacy flow from the protocol capture:

1. Return a `once` token.
2. Return a `sessionid` and profile body.
3. Accept and acknowledge measurement payloads.
4. Accept and acknowledge session delete.

It also sets a configurable legacy-style `Server` header and writes plain-text JSON responses.

## Run with Docker

Build image:

```sh
docker build -t withings-server:latest .
```

Run container:

```sh
docker run --rm -p 80:80 \
  -e WITHINGS_ONCE_TOKEN="21112cb3-1b433eef" \
  -e WITHINGS_USER_ID="101010" \
  -e WITHINGS_SCREEN_NAME="USR" \
  withings-server:latest
```

Health check:

```sh
curl -s http://localhost/healthz
```

## DNS Redirect Reminder

For a physical scale, resolve `scalews.withings.net` to this server on your LAN (local DNS override).

## Sample compose file

The sample compose file creates a dual network solution, so that you can set the hostname of the macvlan interface to scalews.withings.net in your router, but still access the web UI on your docker host DNS name as normal (or via Tailscale if you run that on the docker host).

## Environment Variables

(all optional)

- `PORT` (default `80`)
- `LOG_LEVEL` (default `info`)
- `WITHINGS_ONCE_TOKEN` (default `21112cb3-1b433eef`)
- `WITHINGS_SERVER_HEADER` (legacy-style default set)
- `WITHINGS_USER_ID` (default `101010`)
- `WITHINGS_SCREEN_NAME` (default `USR`)
- `WITHINGS_PROFILE_RE` (default `500`)
- `WITHINGS_PROFILE_RI` (default `2200`)
- `WITHINGS_LANG` (default `en_GB`)
- `WITHINGS_G` (default `97973`)
- `WITHINGS_GOFF` (default `0`)
- `WITHINGS_DST` (default `0`)
- `WITHINGS_NGOFF` (default `0`)
- `SQLITE_PATH` (default `withings.sqlite`)

## SQLite Storage

The server creates and maintains these tables automatically:

- `users`
- `measurements`
- `measurement_values`

For each measurement row, `battery_level` is stored from the session handshake (`batterylvl`) when available.

For `/cgi-bin/session` with `action=new`, the `users[0]` profile values are read from `users` when set:

- `profile_weight_kg` -> `wt`
- `profile_height_m` -> `ht`
- `profile_age_years` -> `agt`
- `profile_sex` -> `sx`

Fallback values are used per field when unset:

- weight: `70kg`
- height: `1.8m` (180cm)
- age: `40`
- sex: `1` (female)

When a new measurement arrives, it is assigned to a `users.id` as follows:

1. Compute each user's average weight across their most recent 5 measurements.
2. Compare the new measurement weight against those averages.
3. If the closest average is within 2kg, assign to that user.
4. If no user is close enough, store the measurement with `user_id = NULL` (unallocated).

No anonymous users are auto-created. Unallocated measurements can be claimed later from the UI.

## Unallocated Claim Flow

The UI supports manual claim operations:

- `GET /api/ui/unlinked` to list unallocated measurements (`measurements.user_id IS NULL`)
- `POST /api/ui/users` to create a user (request body: `{ "screenName": "..." }`)
- `POST /api/ui/unlinked/:measurementId/assign` to claim an unallocated measurement to a user

## Example Measure Request

```sh
curl -s -X POST http://localhost/cgi-bin/measure \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'action=store' \
  --data-urlencode 'sessionid=546-4c818c8e-3b918091' \
  --data-urlencode 'macaddress=00:24:e4:ff:fc:01' \
  --data-urlencode 'userid=101010' \
  --data-urlencode 'meastime=1283558512' \
  --data-urlencode 'devtype=1' \
  --data-urlencode 'attribstatus=0' \
  --data-urlencode 'measures={"measures":[{"value":66850,"type":1,"unit":-3}]}'
```
