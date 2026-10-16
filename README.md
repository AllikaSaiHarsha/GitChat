# Realtime Chat App

Stack: React (Vite) + Node/Express + Socket.io. MongoDB optional.

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

Open two browser windows, join same room with different names to test.

## Features (MVP)
- Join by username + room (`client/src/App.jsx`)
- Send/receive realtime (`server/socket.js`, `client/src/components/Chat.jsx`)
- Online users, typing indicator, history (last 100 msgs in-memory)
- REST fallback: `GET /api/messages/:room` (`server/index.js`)

## Next (Week 2)
- Persist to MongoDB via `server/models/Message.js`
- Auth with JWT
- DMs / private rooms
- Deploy: client on Vercel, server on Render, DB on Atlas
