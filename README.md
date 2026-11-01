<p align="center">
  <img src="client/public/purlway-mark.svg" alt="Purlway woven conversation mark" width="72" />
</p>

<h1 align="center">Purlway</h1>
<p align="center"><em>Team chat, in flow.</em></p>

Purlway is a realtime team chat app built around focused rooms, live presence, and lightweight collaboration.

**Stack:** React and Vite · Node.js and Express · Socket.IO · JWT · optional MongoDB

## Contents

- [Features](#features)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Checks](#checks)
- [Project layout](#project-layout)
- [Documentation](#documentation)

## Features

- **Rooms with memberships** — you only see rooms you're a member of; `#general` is home for everyone.
- **Join passwords** — creating or joining a room takes the password you set; it's checked once, then you're in for good.
- **Admin controls** — whoever creates a room administers it: add members by username (the account must exist), remove them live, manage the roster from the Members panel.
- **Leave a room** — members can walk out anytime (not `#general`; admins can't leave their own room). The password is required again to rejoin.
- **Session resume** — only a real 401 signs you out; a restarting server just retries.
- **Chat niceties** — presence, typing indicators, emoji reactions, markdown + syntax highlighting, a "new messages" divider, a catch-up panel with an activity heatmap, and a command palette (`Ctrl K`).
- **Security** — rate-limited authentication and room-join endpoints, seven-day JWT expiry, and CORS pinned to the client origin.

## Brand

Purlway pairs the purl stitch with a path that connects people. Its visual identity uses a woven conversation mark, warm copper, soft linen, and deep ink. The voice is clear, human, and calm. See [BRAND.md](BRAND.md) for the visual and writing guide.

## Quick start

Use Node.js 24 (see `.nvmrc`) and npm. Run each command group in its own terminal.

### 1. Start the API

```bash
cd server
npm ci
cp .env.example .env
# Edit .env and set JWT_SECRET to a strong random value.
npm run dev
```

The API listens at `http://localhost:5000` by default. MongoDB is optional; without a reachable database, the app uses in-memory stores and data resets when the server restarts.

### 2. Start the client

```bash
cd client
npm ci
npm run dev
```

Open `http://localhost:5173`, create an account, and join `#general`.

## Configuration

Create `server/.env` from `server/.env.example` and set a private `JWT_SECRET` before exposing the API. Production refuses to start if the secret is missing or still set to the example placeholder. Development warns and uses an insecure fallback when no valid secret is set.

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `5000` | API port |
| `CLIENT_URL` | `http://localhost:5173` | Allowed client origin for CORS and Socket.IO |
| `JWT_SECRET` | Example placeholder | Set a long, random value; production requires it |
| `MONGO_URI` | *(unset)* | Optional MongoDB connection; memory stores are used when unavailable |
| `RATE_LIMIT_MAX` | `20` | Failed login, registration, and room-join attempts per IP per 15 minutes |
| `TRUST_PROXY` | *(unset)* | Set to the trusted proxy hop count when running behind a proxy |

Set `client/.env` only when the API uses a different address: `VITE_SERVER_URL` defaults to `http://localhost:5000`.

## Checks

Run the API tests:

```bash
cd server
npm test
```

The API suite starts isolated in-process servers with in-memory data. It covers authentication, sessions, room membership, password joins, member management, leave rules, rate limiting, and socket guards.

Build the client:

```bash
cd client
npm ci
npm run build
```

Optional browser checks use desktop and mobile Chromium:

```bash
cd client
npm install
npx playwright install chromium
npm run test:e2e
```

Playwright starts isolated API and Vite servers on ports `5017` and `5174`. The checks cover registration, session resume, room creation, realtime messaging, and the command palette.

## Project layout

```
server/
  index.js        entry point (env, db connect, listen)
  app.js          createApp() factory: routes + Socket.IO wiring
  auth.js         register/login, JWT, requireAuth
  rooms.js        room store: memberships, passwords, admins
  socket.js       realtime: messages, presence, typing, reactions
  db.js           MongoDB connect (optional) + readiness
  test/           API and socket tests (node:test)
client/src/
  App.jsx         session resume + stage routing (auth / lobby / chat)
  components/     Chat, Sidebar, MessageRow, MarkdownBody, panels, dialogs
  hooks/          socket singleton
  lib/            REST helpers
```

## Documentation

- [Brand guide](BRAND.md) — logo, colors, typography, and voice.
- [Security audit](SECURITY_AUDIT.md) — historical audit findings and remediation record.

Message history and reactions persist in MongoDB when connected. In memory-only mode, both reset when the server restarts.
