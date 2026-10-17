// GitChat API smoke tests.
//
// Boots app instances in-process on ephemeral loopback ports with the
// in-memory store, so a run never touches a dev server you already have open,
// nor the real MongoDB data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

// Set before app.js loads; createApp() reads env when it runs.
process.env.MONGO_URI = '';
process.env.JWT_SECRET = 'smoke-test-secret';

const { createApp } = await import('../app.js');

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}

function closeApp(instance) {
  return new Promise((resolve) => instance?.io.close(resolve));
}

async function api(base, route, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${base}${route}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

const tag = Math.random().toString(36).slice(2, 8);
const U1 = `smoke${tag}a`;
const U2 = `smoke${tag}b`;
const U3 = `smoke${tag}c`;
const ROOM = `room${tag}`;
const PW = 'pw-123456';

let main; // main app instance
let base;
let limitApp; // rate-limit app instance
let token1; // U1 — creates the room (its admin)
let token2; // U2 — joins with the password
let token3; // U3 — added by the admin, then leaves

before(async () => {
  main = createApp();
  base = await listen(main.server);
});

after(async () => {
  await closeApp(main);
  await closeApp(limitApp);
});

test('register → token → /api/me round-trip', async () => {
  const reg = await api(base, '/api/auth/register', { method: 'POST', body: { username: U1, password: PW } });
  assert.equal(reg.status, 201);
  assert.equal(reg.data.username, U1);
  token1 = reg.data.token;
  assert.ok(token1);

  const me = await api(base, '/api/me', { token: token1 });
  assert.equal(me.status, 200);
  assert.deepEqual(me.data, { username: U1 });
});

test('the session check rejects missing, garbage, and expired tokens', async () => {
  assert.equal((await api(base, '/api/me')).status, 401);
  assert.equal((await api(base, '/api/me', { token: 'garbage-token' })).status, 401);
  const expired = jwt.sign({ username: U1 }, 'smoke-test-secret', { expiresIn: -10 });
  assert.equal((await api(base, '/api/me', { token: expired })).status, 401);
});

test('wrong credentials are rejected; the right ones log in', async () => {
  const bad = await api(base, '/api/auth/login', { method: 'POST', body: { username: U1, password: 'not-the-password' } });
  assert.equal(bad.status, 401);
  const ok = await api(base, '/api/auth/login', { method: 'POST', body: { username: U1, password: PW } });
  assert.equal(ok.status, 200);
  token1 = ok.data.token;
});

test('a fresh account only sees #general', async () => {
  const reg2 = await api(base, '/api/auth/register', { method: 'POST', body: { username: U2, password: PW } });
  assert.equal(reg2.status, 201);
  token2 = reg2.data.token;

  const rooms = await api(base, '/api/rooms', { token: token2 });
  assert.equal(rooms.status, 200);
  assert.deepEqual(rooms.data.rooms.map((r) => r.name), ['general']);
});

test('creating a room makes you its admin', async () => {
  const created = await api(base, '/api/rooms/create', { method: 'POST', token: token1, body: { name: ROOM, password: PW } });
  assert.equal(created.status, 201);
  assert.equal(created.data.room, ROOM);
  const mine = created.data.rooms.find((r) => r.name === ROOM);
  assert.equal(mine.admin, true);
});

test('joining requires the correct password — and only once', async () => {
  const wrong = await api(base, '/api/rooms/join', { method: 'POST', token: token2, body: { name: ROOM, password: 'wrong-password' } });
  assert.equal(wrong.status, 401);

  const right = await api(base, '/api/rooms/join', { method: 'POST', token: token2, body: { name: ROOM, password: PW } });
  assert.equal(right.status, 200);
  assert.ok(right.data.rooms.some((r) => r.name === ROOM));

  const again = await api(base, '/api/rooms/join', { method: 'POST', token: token2, body: { name: ROOM } });
  assert.equal(again.status, 200);
});

test('member management is admin-only and validates the target account', async () => {
  const forbidden = await api(base, `/api/rooms/${ROOM}/members`, { method: 'POST', token: token2, body: { username: U3 } });
  assert.equal(forbidden.status, 403);

  const roster = await api(base, `/api/rooms/${ROOM}/members`, { token: token2 });
  assert.equal(roster.status, 200);
  assert.equal(roster.data.createdBy, U1);
  assert.deepEqual(roster.data.members.map((m) => m.username).sort(), [U1, U2].sort());

  const ghost = await api(base, `/api/rooms/${ROOM}/members`, { method: 'POST', token: token1, body: { username: `ghost${tag}` } });
  assert.equal(ghost.status, 404);

  const reg3 = await api(base, '/api/auth/register', { method: 'POST', body: { username: U3, password: PW } });
  assert.equal(reg3.status, 201);
  token3 = reg3.data.token;

  const added = await api(base, `/api/rooms/${ROOM}/members`, { method: 'POST', token: token1, body: { username: U3 } });
  assert.equal(added.status, 200);
  const row = added.data.members.find((m) => m.username === U3);
  assert.ok(row);
  assert.equal(row.admin, false);
});

test('removal revokes membership immediately', async () => {
  const removed = await api(base, `/api/rooms/${ROOM}/members/${U2}`, { method: 'DELETE', token: token1 });
  assert.equal(removed.status, 200);
  assert.ok(!removed.data.members.some((m) => m.username === U2));

  const rooms = await api(base, '/api/rooms', { token: token2 });
  assert.ok(!rooms.data.rooms.some((r) => r.name === ROOM));

  const history = await api(base, `/api/messages/${ROOM}`, { token: token2 });
  assert.equal(history.status, 403);
});

test('leave rules: members can leave, admins and #general cannot', async () => {
  const general = await api(base, '/api/rooms/general/leave', { method: 'POST', token: token3 });
  assert.equal(general.status, 400);

  const adminLeave = await api(base, `/api/rooms/${ROOM}/leave`, { method: 'POST', token: token1 });
  assert.equal(adminLeave.status, 400);

  const left = await api(base, `/api/rooms/${ROOM}/leave`, { method: 'POST', token: token3 });
  assert.equal(left.status, 200);
  assert.ok(!left.data.rooms.some((r) => r.name === ROOM));

  // Leaving drops membership — the password is needed again for a rejoin.
  const rejoin = await api(base, '/api/rooms/join', { method: 'POST', token: token3, body: { name: ROOM, password: PW } });
  assert.equal(rejoin.status, 200);
});

test('repeated password failures hit the rate limit', async () => {
  process.env.RATE_LIMIT_MAX = '3';
  limitApp = createApp();
  const limitBase = await listen(limitApp.server);

  // Successful requests never consume the budget…
  const user = `rl${tag}`;
  const reg = await api(limitBase, '/api/auth/register', { method: 'POST', body: { username: user, password: PW } });
  assert.equal(reg.status, 201);
  const ok = await api(limitBase, '/api/auth/login', { method: 'POST', body: { username: user, password: PW } });
  assert.equal(ok.status, 200);

  // …but three failures exhaust RATE_LIMIT_MAX=3.
  for (let i = 0; i < 3; i += 1) {
    const fail = await api(limitBase, '/api/auth/login', { method: 'POST', body: { username: user, password: 'wrong-password' } });
    assert.equal(fail.status, 401);
  }
  const blocked = await api(limitBase, '/api/auth/login', { method: 'POST', body: { username: user, password: 'wrong-password' } });
  assert.equal(blocked.status, 429);
  assert.match(blocked.data.error || '', /too many attempts/i);
});

test('malformed request payloads get 400s instead of crashes', async () => {
  const create = await api(base, '/api/rooms/create', { method: 'POST', token: token1, body: { name: { nested: true }, password: PW } });
  assert.equal(create.status, 400);

  const join = await api(base, '/api/rooms/join', { method: 'POST', token: token2, body: { name: [ROOM], password: PW } });
  assert.equal(join.status, 400);

  const stats = await api(base, '/api/stats/activity?room[x]=y', { token: token2 });
  assert.equal(stats.status, 400);

  const members = await api(base, `/api/rooms/${ROOM}/members`, { method: 'POST', token: token1, body: { username: 42 } });
  assert.equal(members.status, 400);
});

test('malformed JSON is a clean 400', async () => {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{not json'
  });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'invalid JSON body' });
});

test('the server stays healthy after malformed input', async () => {
  const health = await api(base, '/');
  assert.equal(health.status, 200);
  const rooms = await api(base, '/api/rooms', { token: token1 });
  assert.equal(rooms.status, 200);
});

test('production fails closed without a usable JWT secret', async () => {
  const prev = { nodeEnv: process.env.NODE_ENV, secret: process.env.JWT_SECRET };
  process.env.NODE_ENV = 'production';
  delete process.env.JWT_SECRET;
  try {
    // Signing throws → the route reports 500 instead of issuing a forgeable token.
    const login = await api(base, '/api/auth/login', { method: 'POST', body: { username: U1, password: PW } });
    assert.equal(login.status, 500);
    // Verification fails closed too.
    const me = await api(base, '/api/me', { token: token1 });
    assert.equal(me.status, 401);

    // The public .env.example placeholder is not a secret either.
    process.env.JWT_SECRET = 'change-this-to-a-long-random-string';
    assert.equal((await api(base, '/api/me', { token: token1 })).status, 401);
  } finally {
    if (prev.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prev.nodeEnv;
    process.env.JWT_SECRET = prev.secret;
  }
});
