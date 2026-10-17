// Socket-level regression tests for the audited payload handling:
//  - every payload listener survives malformed payloads (guards return early;
//    nothing throws past the listener boundary)
//  - `typing` is membership-gated (it used to broadcast into any room)
//  - `toggle_reaction` is bound to a message that exists in the room the
//    caller was authorized for (it used to be keyed by message id alone)
//
// Handlers are exercised directly through a fake io/socket pair, so no ports
// are bound and no socket.io-client dependency is needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Same isolation as the smoke tests: in-memory stores only.
process.env.MONGO_URI = '';
process.env.JWT_SECRET = 'socket-guard-test-secret';

const { setupSocket, messageStore } = await import('../socket.js');
const { createRoom } = await import('../rooms.js');
const { getActivity } = await import('../stats.js');

const ME = 'guard-tester';

function fakeIo() {
  const roomEmits = [];
  let connect;
  return {
    roomEmits,
    on(ev, fn) {
      if (ev === 'connection') connect = fn;
    },
    to(room) {
      return { emit: (...args) => roomEmits.push([room, ...args]) };
    },
    connect(s) {
      connect(s);
    }
  };
}

function fakeSocket(username) {
  const handlers = {};
  const toEmits = [];
  const selfEmits = [];
  return {
    id: `guard-${Math.random().toString(36).slice(2, 8)}`,
    data: { username },
    handlers,
    toEmits,
    selfEmits,
    on(ev, fn) {
      handlers[ev] = fn;
    },
    emit(...args) {
      selfEmits.push(args);
    },
    to(room) {
      return { emit: (...args) => toEmits.push([room, ...args]) };
    },
    join() {},
    leave() {}
  };
}

const io = fakeIo();
setupSocket(io);

let socket; // ME's socket

function seed(room, msg) {
  if (!messageStore.has(room)) messageStore.set(room, []);
  messageStore.get(room).push({
    room,
    username: ME,
    text: 'seed',
    createdAt: new Date().toISOString(),
    ...msg
  });
}

async function call(event, payload) {
  const fn = socket.handlers[event];
  assert.equal(typeof fn, 'function', `handler registered: ${event}`);
  await fn(payload);
}

test('listeners are registered for the connection', () => {
  socket = fakeSocket(ME);
  io.connect(socket);
  for (const ev of ['join_room', 'send_message', 'typing', 'toggle_reaction', 'disconnect']) {
    assert.equal(typeof socket.handlers[ev], 'function', `${ev} handler`);
  }
});

test('every payload listener survives malformed payloads without internal errors', async () => {
  const warnings = [];
  const origWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    const payloads = [undefined, null, 0, 'nope', [], {}, { room: 9, text: [], messageId: {}, emoji: 1 }];
    for (const ev of ['join_room', 'send_message', 'typing', 'toggle_reaction']) {
      for (const payload of payloads) {
        await call(ev, payload); // must not throw or reject
      }
    }
  } finally {
    console.warn = origWarn;
  }
  // No handler-error warnings: the guards returned early instead of throwing.
  assert.deepEqual(warnings, []);
});

test('typing is membership-gated', async () => {
  // Member of the open room: the broadcast happens.
  socket.toEmits.length = 0;
  await call('typing', { room: 'general', isTyping: true });
  assert.ok(socket.toEmits.some(([room, ev]) => room === 'general' && ev === 'user_typing'));

  // Not a member of a password-protected room: suppressed.
  const created = await createRoom('guard-private', 'pw-123456', ME);
  assert.equal(created.error, undefined);
  const outsider = fakeSocket('outsider');
  io.connect(outsider);
  outsider.toEmits.length = 0;
  await outsider.handlers.typing({ room: 'guard-private', isTyping: true });
  assert.equal(outsider.toEmits.length, 0);

  // The room's member still gets through.
  socket.toEmits.length = 0;
  await call('typing', { room: 'guard-private', isTyping: true });
  assert.ok(socket.toEmits.some(([room, ev]) => room === 'guard-private' && ev === 'user_typing'));

  // A malformed room value is ignored before any membership check.
  socket.toEmits.length = 0;
  await call('typing', { room: 42, isTyping: true });
  assert.equal(socket.toEmits.length, 0);
});

test('socket handlers canonicalize room keys the same way join_room does', async () => {
  const canon = fakeSocket('canon-tester');
  io.connect(canon);

  // A non-canonical variant of the open room must land in the canonical key.
  const before = io.roomEmits.length;
  await canon.handlers.send_message({ room: '  GENeral!! ', text: 'hello' });
  const received = io.roomEmits.slice(before).filter(([, ev]) => ev === 'receive_message');
  assert.equal(received.length, 1);
  assert.equal(received[0][0], 'general');
  assert.equal(received[0][2].room, 'general');

  canon.toEmits.length = 0;
  await canon.handlers.typing({ room: 'GENeral!!', isTyping: true });
  assert.ok(canon.toEmits.some(([room, ev]) => room === 'general' && ev === 'user_typing'));

  // Reactions accept the same variant against the canonical room.
  seed('general', { id: 'canon-msg' });
  const beforeReaction = io.roomEmits.length;
  await canon.handlers.toggle_reaction({ room: 'General', messageId: 'canon-msg', emoji: '👍' });
  const reactions = io.roomEmits.slice(beforeReaction).filter(([, ev]) => ev === 'message_reaction');
  assert.equal(reactions.length, 1);
  assert.equal(reactions[0][0], 'general');
});

test('reactions are bound to a message in the room the caller was authorized for', async () => {
  const reactionEvents = () => io.roomEmits.filter(([, ev]) => ev === 'message_reaction');

  // A message that lives in #general, and a second room ME is a member of.
  seed('general', { id: 'guard-msg-general' });
  const created = await createRoom('guard-reactions', 'pw-123456', ME);
  assert.equal(created.error, undefined);

  // Member of the target room + message belongs to that room → broadcast.
  io.roomEmits.length = 0;
  await call('toggle_reaction', { room: 'general', messageId: 'guard-msg-general', emoji: '👍' });
  assert.equal(reactionEvents().length, 1);
  const [, , payload] = reactionEvents()[0];
  assert.equal(reactionEvents()[0][0], 'general');
  assert.deepEqual(payload, {
    messageId: 'guard-msg-general',
    reactions: [{ emoji: '👍', users: [ME] }]
  });

  // Member of #guard-reactions, but the message lives in #general → rejected.
  io.roomEmits.length = 0;
  await call('toggle_reaction', { room: 'guard-reactions', messageId: 'guard-msg-general', emoji: '👍' });
  assert.equal(reactionEvents().length, 0);

  // A message in its own room works — proving the block above was the room
  // binding, not a broken handler.
  seed('guard-reactions', { id: 'guard-msg-own' });
  await call('toggle_reaction', { room: 'guard-reactions', messageId: 'guard-msg-own', emoji: '🎉' });
  assert.equal(reactionEvents().length, 1);
  assert.equal(reactionEvents()[0][0], 'guard-reactions');

  // Payload rejects: emoji outside the allowlist, oversized / unknown ids.
  io.roomEmits.length = 0;
  await call('toggle_reaction', { room: 'guard-reactions', messageId: 'guard-msg-own', emoji: '💀' });
  await call('toggle_reaction', { room: 'guard-reactions', messageId: 'x'.repeat(65), emoji: '🎉' });
  await call('toggle_reaction', { room: 'guard-reactions', messageId: 'missing-id', emoji: '🎉' });
  assert.equal(reactionEvents().length, 0);

  // Toggling the same reaction again removes it and reports an empty list.
  await call('toggle_reaction', { room: 'guard-reactions', messageId: 'guard-msg-own', emoji: '🎉' });
  assert.deepEqual(reactionEvents().at(-1)[2].reactions, []);
});

test('reactions are attached to the history sent when rejoining', async () => {
  seed('general', { id: 'hist-msg-1' });
  const s = fakeSocket('hist-tester');
  io.connect(s);
  await s.handlers.toggle_reaction({ room: 'general', messageId: 'hist-msg-1', emoji: '🚀' });
  s.selfEmits.length = 0;
  await s.handlers.join_room({ room: 'general' });
  const history = s.selfEmits.filter(([ev]) => ev === 'message_history').at(-1)[1];
  const entry = history.find((m) => m.id === 'hist-msg-1');
  assert.deepEqual(entry.reactions, [{ emoji: '🚀', users: ['hist-tester'] }]);
});

test('socket token buckets cap sustained bursts', async () => {
  // send_message: a rapid burst is capped at MESSAGE_BURST=20 accepted sends.
  const sender = fakeSocket('bucket-sender');
  io.connect(sender);
  const beforeSends = io.roomEmits.length;
  for (let i = 0; i < 25; i += 1) {
    await sender.handlers.send_message({ room: 'general', text: `burst ${i}` });
  }
  const received = io.roomEmits.slice(beforeSends).filter(([, ev]) => ev === 'receive_message').length;
  assert.equal(received, 20);

  // join_room: a rapid burst is capped at JOIN_BURST=5 accepted joins per user.
  const joiner = fakeSocket('bucket-joiner');
  io.connect(joiner);
  const beforeJoins = io.roomEmits.length;
  for (let i = 0; i < 8; i += 1) {
    await joiner.handlers.join_room({ room: 'general' });
  }
  const joined = io.roomEmits.slice(beforeJoins).filter(([, ev]) => ev === 'room_users').length;
  assert.equal(joined, 5);
});

test('activity stats count the rolling window per day (memory path)', async () => {
  const room = 'guard-activity';
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  seed(room, { id: 'act-1', username: ME, createdAt: new Date(now).toISOString() });
  seed(room, { id: 'act-2', username: 'someone-else', createdAt: new Date(now).toISOString() });
  seed(room, { id: 'act-3', username: ME, createdAt: new Date(now - 90 * 24 * 60 * 60 * 1000).toISOString() });

  const activity = await getActivity(room, ME);
  assert.equal(activity.room, room);
  assert.equal(activity.windowDays, 84);
  // two recent messages today, one old message outside the window
  assert.deepEqual(activity.days, { [today]: 2 });
  assert.deepEqual(activity.mineDays, { [today]: 1 });
});
