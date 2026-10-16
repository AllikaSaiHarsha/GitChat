import express from 'express';
import http from 'http';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { Server } from 'socket.io';
import { setupSocket, messageStore, loadHistory, evictFromRoom } from './socket.js';
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
  app.use(cors({ origin: CLIENT_URL }));
  app.use(express.json());

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

  // Messages persist to MongoDB when connected; the in-memory store doubles
  // as a hot cache and as the no-database fallback (see socket.js).

  app.get('/', (req, res) => {
    res.json({ status: 'ok', message: 'GitChat server running' });
  });

  app.get('/api/messages/:room', requireAuth, async (req, res) => {
    const room = normalizeRoomName(req.params.room) || 'general';
    if (!(await isMember(room, req.user.username))) {
      return res.status(403).json({ error: 'not a member of this room' });
    }
    try {
      res.json(await loadHistory(room));
    } catch {
      res.json(messageStore.get(room) || []);
    }
  });

  // Per-day activity counts for the heatmap in the "Catch me up" panel.
  app.get('/api/stats/activity', requireAuth, async (req, res) => {
    const room = req.query.room || 'general';
    if (!(await isMember(normalizeRoomName(room) || 'general', req.user.username))) {
      return res.json({ room, windowDays: 84, days: {}, mineDays: {} });
    }
    try {
      res.json(await getActivity(room, req.user.username));
    } catch {
      res.json({ room, windowDays: 84, days: {}, mineDays: {} });
    }
  });

  app.post('/api/auth/register', passwordLimiter, async (req, res) => {
    try {
      const { username, password } = req.body || {};
      res.status(201).json(await registerUser(username, password));
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message || 'register failed' });
    }
  });

  app.post('/api/auth/login', passwordLimiter, async (req, res) => {
    try {
      const { username, password } = req.body || {};
      res.json(await loginUser(username, password));
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message || 'login failed' });
    }
  });

  app.get('/api/me', requireAuth, (req, res) => {
    res.json({ username: req.user.username });
  });

  // Rooms: you only ever see the ones you're a member of (#general is everyone's).
  app.get('/api/rooms', requireAuth, async (req, res) => {
    try {
      res.json({ rooms: await listRoomsFor(req.user.username) });
    } catch {
      res.json({ rooms: [{ name: 'general', locked: false }] });
    }
  });

  // Create a room: a password is required and is what gates the first join.
  app.post('/api/rooms/create', requireAuth, async (req, res) => {
    const { name, password } = req.body || {};
    const result = await createRoom(name, password, req.user.username);
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    res.status(201).json({ room: result.room, rooms: await listRoomsFor(req.user.username) });
  });

  // Join a room: password checked once, then you're a member for good.
  app.post('/api/rooms/join', passwordLimiter, requireAuth, async (req, res) => {
    const { name, password } = req.body || {};
    const result = await joinRoom(name, password, req.user.username);
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    res.json({ room: result.room, rooms: await listRoomsFor(req.user.username) });
  });

  app.get('/api/rooms/:name/members', requireAuth, async (req, res) => {
    const name = normalizeRoomName(req.params.name);
    if (!name) return res.status(400).json({ error: 'enter a room name' });
    if (!(await isMember(name, req.user.username))) {
      return res.status(403).json({ error: 'not a member of this room' });
    }
    res.json(await memberPayload(name));
  });

  // Admin only: add a member by username (no password needed — the admin vouches).
  app.post('/api/rooms/:name/members', requireAuth, async (req, res) => {
    const name = normalizeRoomName(req.params.name);
    const target = (req.body?.username || '').trim();
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
  });

  // Admin only: remove a member (the admin themselves can't be removed).
  app.delete('/api/rooms/:name/members/:username', requireAuth, async (req, res) => {
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
  });

  // Leave a room on your own: membership is dropped (the password is needed
  // again to rejoin). Admins can't leave their own room, and #general is home.
  app.post('/api/rooms/:name/leave', requireAuth, async (req, res) => {
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
