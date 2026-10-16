# GitChat

A realtime chat app wearing a GitHub-dark theme — rooms, memberships, join passwords, and admin tooling.

Stack: **React (Vite)** + **Node/Express** + **Socket.IO** · JWT auth · MongoDB optional (in-memory fallback)

## Features

- **Rooms with memberships** — you only see rooms you're a member of; `#general` is home for everyone.
- **Join passwords** — creating or joining a room takes the password you set; it's checked once, then you're in for good.
- **Admin controls** — whoever creates a room administers it: add members by username (the account must exist), remove them live, manage the roster from the Members panel.
- **Leave a room** — members can walk out anytime (not `#general`; admins can't leave their own room). The password is required again to rejoin.
- **Session resume** — only a real 401 signs you out; a restarting server just retries.
- **Chat niceties** — presence, typing indicators, emoji reactions, markdown + syntax highlighting, a "new messages" divider, a catch-up panel with an activity heatmap, and a command palette (`Ctrl K`).
- **Guards** — rate-limited auth/join endpoints, 7-day JWT expiry, CORS pinned to the client origin.

## Run locally

1. Server:
```bash
cd server
cp .env.example .env
npm install
npm run dev
# -> http://localhost:5000
```

2. Client (new terminal):
```bash
cd client
npm install
npm run dev
# -> http://localhost:5173
```

Register an account in the client and start talking. `#general` always exists.

## Environment

`server/.env`:

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `5000` | |
| `CLIENT_URL` | `http://localhost:5173` | CORS + Socket.IO origin |
| `JWT_SECRET` | dev default (warns) | Set a long random string |
| `MONGO_URI` | *(unset)* | When unset or unreachable, the server runs fully in-memory (data resets on restart) |
| `RATE_LIMIT_MAX` | `20` | Failed login/register/join attempts per IP per 15 min |

`client/.env` (optional): `VITE_SERVER_URL` (default `http://localhost:5000`).

## Tests

```bash
cd server
npm test
```

Boots app instances in-process on ephemeral ports with the in-memory store — no running server, database, or port juggling required. Covers auth, session/token errors, room memberships, password joins, admin member management, leave rules, and rate limiting.

## Layout

```
server/
  index.js        entry point (env, db connect, listen)
  app.js          createApp() factory: routes + Socket.IO wiring
  auth.js         register/login, JWT, requireAuth
  rooms.js        room store: memberships, passwords, admins
  socket.js       realtime: messages, presence, typing, reactions
  db.js           MongoDB connect (optional) + readiness
  test/           smoke tests (node:test)
client/src/
  App.jsx         session resume + stage routing (auth / lobby / chat)
  components/     Chat, Sidebar, MessageRow, MarkdownBody, panels, dialogs
  hooks/          socket singleton
  lib/            REST helpers
```

## Notes

- Reactions are intentionally in-memory (they reset with the server).
- Message history persists in MongoDB when it's connected; otherwise everything lives in memory and resets on restart.
