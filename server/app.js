import express from 'express';
import http from 'http';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { Server } from 'socket.io';
import { setupSocket, loadHistory, loadCatchUp, evictFromRoom } from './socket.js';
import { getActivity } from './stats.js';
import { registerUser, loginUser, verifyToken, requireAuth, userExists } from './auth.js';
import {
  listRoomsFor,
  createRoom,
  joinRoom,
  isMember,
  normalizeRoomName,
  isAdmin,
  roomMembers,
  addMember,
  removeMember
} from './rooms.js';

// Express 4 does not forward rejected promises from async handlers, so one
// unexpected rejection would reach the runtime's default handler and kill the
// shared REST + socket process. Every awaited route is wrapped so failures
// reach the JSON error middleware near the bottom of createApp().
const asyncRoute = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

// Member roster for a room (visible to its members; creator flagged as admin).
async function memberPayload(name) {
  const { members, createdBy } = await roomMembers(name);
  return {
    room: name,
    createdBy,
    members: members.map((u) => ({ username: u, admin: u === createdBy }))
  };
}

// Builds the Express app + Socket.IO server without binding a port, so tests
// can run instances in-process. index.js is the entry point that listens.
export function createApp() {
  const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

  const app = express();

  // Behind a deployment proxy (Cloudflare, Render, Fly.io, nginx, …) the rate
  // limiters must key on the client IP in X-Forwarded-For — but only when
  // such a proxy is actually in front, otherwise a client could spoof the
  // header and sidestep the limits. Set TRUST_PROXY in the deployment
  // environment: a hop count like "1", or an Express trust-proxy value.
  if (process.env.TRUST_PROXY) {
    const trustProxy = process.env.TRUST_PROXY;
    app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);
  }

  app.use(cors({ origin: CLIENT_URL }));
  app.use(express.json());

  // Security headers for API responses: the SPA's own CSP/frame policy is set
  // at its serving layer (see client/vite.config.js); these bound the API.
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    next();
  });

  // Brute-force guard for every password-checking endpoint (login, register,
  // room join). Only failed attempts consume the budget, so normal use never
  // trips it. `RATE_LIMIT_MAX` overrides the cap (used by the smoke tests).
  const passwordLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: Number(process.env.RATE_LIMIT_MAX || 20),
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { error: 'Too many attempts — please wait a few minutes and try again.' }
  });

  // General guard for the remaining API surface: room create, member
  // management, and the data-heavy stats reads (the password limiter above
  // only covers credential checks).
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests — slow down a little.' }
  });

  // Messages persist to MongoDB when connected; the in-memory store doubles
  // as a hot cache and as the no-database fallback (see socket.js).

  app.get('/', (req, res) => {
    res.json({ status: 'ok', message: 'Purlway server running' });
  });

  app.get('/api/messages/:room', requireAuth, asyncRoute(async (req, res) => {
    const room = normalizeRoomName(req.params.room) || 'general';
    const rawSince = req.query.since;
    if (rawSince !== undefined && typeof rawSince !== 'string') {
      return res.status(400).json({ error: 'invalid since timestamp' });
    }
    const since = rawSince === undefined ? null : new Date(rawSince);
    if (since && Number.isNaN(since.getTime())) {
      return res.status(400).json({ error: 'invalid since timestamp' });
    }
    if (!(await isMember(room, req.user.username))) {
      return res.status(403).json({ error: 'not a member of this room' });
    }
    try {
      res.json(since ? await loadCatchUp(room, since) : await loadHistory(room));
    } catch {
      res.status(503).json({ error: 'Message history is temporarily unavailable.' });
    }
  }));

  // Per-day activity counts for the heatmap in the "Catch me up" panel.
  app.get('/api/stats/activity', apiLimiter, requireAuth, asyncRoute(async (req, res) => {
    // Query strings can repeat (?room=a&room=b) or nest (?room[x]=y) — the
    // parser then hands back an array/object, which TypeErrors deeper down.
    const rawRoom = req.query.room;
    if (rawRoom !== undefined && typeof rawRoom !== 'string') {
      return res.status(400).json({ error: 'invalid room' });
    }
    // Canonicalize once: the same value authorizes the caller and drives the
    // aggregation, so a raw selector can never disagree with the membership
    // check (the old split could authorize #general but query "GENeral").
    const room = normalizeRoomName(rawRoom) || 'general';
    if (!(await isMember(room, req.user.username))) {
      return res.json({ room, windowDays: 84, days: {}, mineDays: {} });
    }
    try {
      res.json(await getActivity(room, req.user.username));
    } catch {
      res.status(503).json({ error: 'Activity data is temporarily unavailable.' });
    }
  }));

  app.post('/api/auth/register', passwordLimiter, asyncRoute(async (req, res) => {
    try {
      const { username, password } = req.body || {};
      res.status(201).json(await registerUser(username, password));
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message || 'register failed' });
    }
  }));

  app.post('/api/auth/login', passwordLimiter, asyncRoute(async (req, res) => {
    try {
      const { username, password } = req.body || {};
      res.json(await loginUser(username, password));
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message || 'login failed' });
    }
  }));

  app.get('/api/me', requireAuth, (req, res) => {
    res.json({ username: req.user.username });
  });

  // Rooms: you only ever see the ones you're a member of (#general is everyone's).
  app.get('/api/rooms', requireAuth, asyncRoute(async (req, res) => {
    try {
      res.json({ rooms: await listRoomsFor(req.user.username) });
    } catch {
      res.status(503).json({ error: 'Room list is temporarily unavailable.' });
    }
  }));

  // Create a room: a password is required and is what gates the first join.
  app.post('/api/rooms/create', apiLimiter, requireAuth, asyncRoute(async (req, res) => {
    const { name, password } = req.body || {};
    // Non-string fields crash normalization/hashing deeper down (TypeError).
    if ((name !== undefined && typeof name !== 'string') ||
        (password !== undefined && typeof password !== 'string')) {
      return res.status(400).json({ error: 'invalid room details' });
    }
    const result = await createRoom(name, password, req.user.username);
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    res.status(201).json({ room: result.room, rooms: await listRoomsFor(req.user.username) });
  }));

  // Join a room: password checked once, then you're a member for good.
  app.post('/api/rooms/join', passwordLimiter, requireAuth, asyncRoute(async (req, res) => {
    const { name, password } = req.body || {};
    // Non-string fields crash normalization/hashing deeper down (TypeError).
    if ((name !== undefined && typeof name !== 'string') ||
        (password !== undefined && typeof password !== 'string')) {
      return res.status(400).json({ error: 'invalid room details' });
    }
    const result = await joinRoom(name, password, req.user.username);
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    res.json({ room: result.room, rooms: await listRoomsFor(req.user.username) });
  }));

  app.get('/api/rooms/:name/members', apiLimiter, requireAuth, asyncRoute(async (req, res) => {
    const name = normalizeRoomName(req.params.name);
    if (!name) return res.status(400).json({ error: 'enter a room name' });
    if (!(await isMember(name, req.user.username))) {
      return res.status(403).json({ error: 'not a member of this room' });
    }
    res.json(await memberPayload(name));
  }));

  // Admin only: add a member by username (no password needed — the admin vouches).
  app.post('/api/rooms/:name/members', apiLimiter, requireAuth, asyncRoute(async (req, res) => {
    const name = normalizeRoomName(req.params.name);
    const rawTarget = req.body?.username;
    // A non-string username would TypeError on .trim() before any gate runs.
    if (rawTarget !== undefined && typeof rawTarget !== 'string') {
      return res.status(400).json({ error: 'invalid username' });
    }
    const target = (rawTarget || '').trim();
    if (!(await isAdmin(name, req.user.username))) {
      return res.status(403).json({ error: 'only the room admin can manage members' });
    }
    if (!target) return res.status(400).json({ error: 'enter a username' });
    if (await isMember(name, target)) {
      return res.status(409).json({ error: `${target} is already in #${name}.` });
    }
    if (!(await userExists(target))) {
      return res.status(404).json({ error: `No account named "${target}".` });
    }
    await addMember(name, target);
    res.json(await memberPayload(name));
  }));

  // Admin only: remove a member (the admin themselves can't be removed).
  app.delete('/api/rooms/:name/members/:username', apiLimiter, requireAuth, asyncRoute(async (req, res) => {
    const name = normalizeRoomName(req.params.name);
    const target = req.params.username;
    if (!(await isAdmin(name, req.user.username))) {
      return res.status(403).json({ error: 'only the room admin can manage members' });
    }
    const { createdBy } = await roomMembers(name);
    if (target === createdBy) {
      return res.status(400).json({ error: 'the room admin cannot be removed' });
    }
    await removeMember(name, target);
    // If they're sitting in the room right now, pull them out immediately.
    evictFromRoom(io, name, target);
    res.json(await memberPayload(name));
  }));

  // Leave a room on your own: membership is dropped (the password is needed
  // again to rejoin). Admins can't leave their own room, and #general is home.
  app.post('/api/rooms/:name/leave', requireAuth, asyncRoute(async (req, res) => {
    const name = normalizeRoomName(req.params.name);
    const username = req.user.username;
    if (!name || name === 'general') {
      return res.status(400).json({ error: "You're always in #general." });
    }
    if (!(await isMember(name, username))) {
      return res.status(403).json({ error: 'not a member of this room' });
    }
    if (await isAdmin(name, username)) {
      return res.status(400).json({ error: `You're the admin of #${name} — admins can't leave their own room.` });
    }
    await removeMember(name, username);
    evictFromRoom(io, name, username, 'left');
    res.json({ room: name, rooms: await listRoomsFor(username) });
  }));

  // Error middleware: anything asyncRoute forwards (plus body-parser's
  // malformed-JSON error) becomes a JSON response — never a dead process.
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'invalid JSON body' });
    }
    console.error('[api]', req.method, req.originalUrl, '-', err?.stack || err);
    res.status(err?.status || 500).json({ error: err?.status ? err.message : 'internal server error' });
  });

  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: CLIENT_URL, methods: ['GET', 'POST'] }
  });

  // Reject sockets without a valid JWT (client sends it as auth: { token }).
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || '';
    if (!token) return next(new Error('unauthorized: missing token'));
    try {
      const payload = verifyToken(token);
      socket.data.username = payload.username; // authoritative identity
      next();
    } catch {
      next(new Error('unauthorized: invalid token'));
    }
  });

  setupSocket(io);

  return { app, server, io };
}
