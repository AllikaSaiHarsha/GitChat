// In-memory store: room -> [{ id, room, username, text, createdAt }]
// Capped at 100 messages per room. Used as fallback when MongoDB is down,
// and as a hot cache alongside it.
import { Message } from './models/Message.js';
import { isDbConfigured, isDbReady } from './db.js';
import { isMember, joinRoom, normalizeRoomName } from './rooms.js';

export const messageStore = new Map();
export const historyEvictedRooms = new Set();
// Activity counts are independent from the bounded 100-message history cache.
export const activityStore = new Map();

function recordActivity(msg) {
  let days = activityStore.get(msg.room);
  if (!days) {
    days = new Map();
    activityStore.set(msg.room, days);
  }
  const day = msg.createdAt.slice(0, 10);
  let counts = days.get(day);
  if (!counts) {
    counts = new Map();
    days.set(day, counts);
  }
  counts.set(msg.username, (counts.get(msg.username) || 0) + 1);
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  for (const key of days.keys()) if (key < cutoff) days.delete(key);
}
export const users = new Map(); // socket.id -> { username, room }

// Reactions: room -> messageId -> Map(emoji -> Set(username)).
// Per-room so events in one room can never read or mutate another room's
// entries by message id. With MongoDB connected the message document's
// reactions array is the source of truth (so reactions survive restarts) and
// this store is hydrated from it; without MongoDB it is the only store.
// Each room's slice is capped.
export const reactionStore = new Map();
export const ALLOWED_REACTIONS = ['👍', '👎', '😄', '🎉', '😕', '❤️', '🚀', '👀'];
const REACTION_ROOM_CAP = 500;

// [{ emoji, users: [names] }] for one message of one room (empty when none).
export function summarizeReactions(room, messageId) {
  const byEmoji = reactionStore.get(room)?.get(messageId);
  if (!byEmoji) return [];
  return [...byEmoji.entries()].map(([emoji, names]) => ({ emoji, users: [...names] }));
}

// Replace one message's reactions in the memory store: used by the DB path
// and by history loads so later toggles report the complete state.
function setMemoryReactions(room, messageId, list) {
  let roomReactions = reactionStore.get(room);
  if (!roomReactions) {
    roomReactions = new Map();
    reactionStore.set(room, roomReactions);
  }
  const byEmoji = new Map();
  for (const r of list || []) {
    if (r && typeof r.emoji === 'string' && Array.isArray(r.users) && r.users.length) {
      byEmoji.set(r.emoji, new Set(r.users));
    }
  }
  if (!byEmoji.size) {
    roomReactions.delete(messageId);
    if (!roomReactions.size) reactionStore.delete(room);
    return;
  }
  roomReactions.set(messageId, byEmoji);
  if (roomReactions.size > REACTION_ROOM_CAP) {
    roomReactions.delete(roomReactions.keys().next().value);
  }
}

// The memory-only toggle (also the fallback for messages whose Mongo insert
// is still in flight): flip the caller's membership in one emoji entry.
function toggleReactionInMemory(room, messageId, emoji, username) {
  let roomReactions = reactionStore.get(room);
  if (!roomReactions) {
    roomReactions = new Map();
    reactionStore.set(room, roomReactions);
  }
  let byEmoji = roomReactions.get(messageId);
  if (!byEmoji) {
    byEmoji = new Map();
    roomReactions.set(messageId, byEmoji);
    // keep each room's map bounded on long-running servers
    if (roomReactions.size > REACTION_ROOM_CAP) {
      roomReactions.delete(roomReactions.keys().next().value);
    }
  }
  let names = byEmoji.get(emoji);
  if (!names) {
    names = new Set();
    byEmoji.set(emoji, names);
  }
  if (names.has(username)) names.delete(username);
  else names.add(username);
  if (!names.size) byEmoji.delete(emoji);
  if (!byEmoji.size) roomReactions.delete(messageId);
  if (!roomReactions.size) reactionStore.delete(room);
}

function getRoomMessages(room) {
  if (!messageStore.has(room)) messageStore.set(room, []);
  return messageStore.get(room);
}

// Does this message id belong to this room? Reactions are bound to room +
// message, so membership in one room can't unlock another room's history.
// MongoDB holds the full history; the memory store only the recent window.
async function messageExistsInRoom(room, messageId) {
  if (getRoomMessages(room).some((m) => m.id === messageId)) return true;
  if (!isDbReady()) return false;
  try {
    const selector = legacyAwareSelector(room, messageId);
    return !!(await Message.exists(selector));
  } catch {
    return false;
  }
}

function legacyAwareSelector(room, messageId) {
  const alternatives = [{ mid: messageId }];
  if (/^[a-f\d]{24}$/i.test(messageId)) {
    alternatives.push({ mid: { $exists: false }, _id: messageId });
  }
  return { room, $or: alternatives };
}

// Toggle one reaction on a persisted message. Element-level operators keep
// concurrent toggles by different users from clobbering each other: remove
// first (a no-op when the user isn't in the entry), otherwise add. Returns
// the final reactions array, or null when the document doesn't exist yet
// (the caller then falls back to the memory toggle).
async function toggleReactionInDb(room, messageId, emoji, username) {
  const selector = legacyAwareSelector(room, messageId);
  const removed = await Message.updateOne(
    { ...selector, reactions: { $elemMatch: { emoji, users: username } } },
    { $pull: { 'reactions.$.users': username } }
  );
  if (removed.modifiedCount) {
    // Drop emoji entries that lost their last user.
    await Message.updateOne(selector, { $pull: { reactions: { users: { $size: 0 } } } });
  } else {
    const added = await Message.updateOne(
      { ...selector, 'reactions.emoji': emoji },
      { $addToSet: { 'reactions.$.users': username } }
    );
    if (!added.matchedCount) {
      await Message.updateOne(
        { ...selector, 'reactions.emoji': { $ne: emoji } },
        { $push: { reactions: { emoji, users: [username] } } }
      );
    }
  }
  const doc = await Message.findOne(selector).select('reactions').lean();
  if (!doc) return null;
  return doc.reactions || [];
}

// Last 100 messages, oldest first. MongoDB when connected, else memory.
// Reactions are merged in at read time (they live in reactionStore).
export async function loadHistory(room) {
  let list;
  if (isDbReady()) {
    // Read the most recent window, then reverse it for chronological display.
    const docs = (await Message.find({ room }).sort({ createdAt: -1 }).limit(100).lean()).reverse();
    list = docs.map((d) => ({
      id: d.mid || d._id.toString(),
      room: d.room,
      username: d.username,
      text: d.text,
      createdAt: d.createdAt.toISOString()
    }));
    // Hydrate the live store from the persisted reactions so toggles on
    // messages outside the memory window start from the stored state.
    for (const d of docs) {
      setMemoryReactions(room, d.mid || d._id.toString(), d.reactions || []);
    }
  } else if (isDbConfigured()) {
    throw Object.assign(new Error('Message history is temporarily unavailable.'), { status: 503 });
  } else {
    list = getRoomMessages(room);
  }
  return list.map((m) => ({ ...m, reactions: summarizeReactions(room, m.id) }));
}

// Bounded catch-up payload with an exact count when MongoDB is available.
// The memory fallback explicitly identifies when older history was evicted.
export async function loadCatchUp(room, since) {
  if (isDbReady()) {
    const filter = { room, username: { $ne: 'system' }, createdAt: { $gt: since } };
    const [docs, totalCount, people] = await Promise.all([
      Message.find(filter).sort({ createdAt: -1 }).limit(100).lean(),
      Message.countDocuments(filter),
      Message.distinct('username', { room, username: { $ne: 'system' }, createdAt: { $gt: since } })
    ]);
    return {
      messages: docs.reverse().map((d) => ({
        id: d.mid || d._id.toString(),
        room: d.room,
        username: d.username,
        text: d.text,
        createdAt: d.createdAt.toISOString(),
        reactions: d.reactions || []
      })),
      totalCount,
      peopleCount: people.length,
      partial: false
    };
  }
  const all = getRoomMessages(room).filter((m) => new Date(m.createdAt).getTime() > since.getTime());
  const chat = all.filter((m) => m.username !== 'system');
  return {
    messages: chat.slice(-100),
    totalCount: chat.length,
    peopleCount: new Set(chat.map((m) => m.username)).size,
    partial: isDbConfigured() || historyEvictedRooms.has(room)
  };
}

function persistMessage(msg) {
  if (!isDbReady()) return Promise.resolve(false);
  return Message.create({
    mid: msg.id,
    room: msg.room,
    username: msg.username,
    text: msg.text,
    createdAt: msg.createdAt
  }).then(() => true);
}

function getRoomUsers(room) {
  const list = [];
  for (const u of users.values()) {
    if (u.room === room) list.push(u.username);
  }
  return [...new Set(list)];
}

// Membership ended (admin removal or the user leaving): pull their live
// sockets out of the room, tell their client why, and refresh presence.
// No-op when they're offline.
export function evictFromRoom(io, room, username, reason = 'removed') {
  if (!io) return;
  let evicted = false;
  for (const [id, u] of users) {
    if (u.room === room && u.username === username) {
      const s = io.sockets.sockets.get(id);
      if (s) {
        s.leave(room);
        s.emit('removed_from_room', { room, reason });
      }
      users.delete(id);
      evicted = true;
    }
  }
  if (evicted) {
    io.to(room).emit('user_typing', { username, isTyping: false });
    io.to(room).emit('user_left', { username });
    io.to(room).emit('room_users', getRoomUsers(room));
  }
}

// Abuse guards: small token buckets for client-emitted events. join_room can
// trigger a bcrypt compare (password rooms) and send_message drives fan-out,
// so both are keyed per user — shared across that user's tabs — while typing
// and reaction chatter is keyed per connection. Bursts stay generous;
// sustained rates are capped.
const JOIN_BURST = 5;
const JOIN_REFILL_PER_SEC = 0.2; // ≈ one join attempt every 5s sustained
const MESSAGE_BURST = 20;
const MESSAGE_REFILL_PER_SEC = 1;
const CHATTER_BURST = 30;
const CHATTER_REFILL_PER_SEC = 2;

function tokenBucket(burst, refillPerSec) {
  let tokens = burst;
  let last = Date.now();
  return () => {
    const now = Date.now();
    tokens = Math.min(burst, tokens + ((now - last) / 1000) * refillPerSec);
    last = now;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}

export function setupSocket(io) {
  // Wraps a listener so a malformed payload or an unexpected error can never
  // escape it: payload shapes are validated per handler, and anything thrown
  // is logged here instead of reaching the runtime's crash path.
  const safeHandler = (fn) => (payload) => {
    try {
      return Promise.resolve(fn(payload)).catch((err) => {
        console.warn('[socket] handler error:', err?.message || err);
      });
    } catch (err) {
      console.warn('[socket] handler error:', err?.message || err);
    }
  };

  // Per-user buckets live for the life of the process (usernames come from
  // verified JWTs, so the key space is the real user list).
  const joinBuckets = new Map();
  const messageBuckets = new Map();
  const bucketFor = (map, key, burst, refillPerSec) => {
    let bucket = map.get(key);
    if (!bucket) {
      bucket = tokenBucket(burst, refillPerSec);
      map.set(key, bucket);
    }
    return bucket;
  };

  io.on('connection', (socket) => {
    const chatter = tokenBucket(CHATTER_BURST, CHATTER_REFILL_PER_SEC);
    socket.data.joinRevision = 0;
    socket.data.disconnected = false;
    // console.log('connected:', socket.id);

    socket.on('join_room', safeHandler(async (payload) => {
      const joinRevision = ++socket.data.joinRevision;
      socket.data.disconnected = false;
      const room = payload && typeof payload === 'object' ? payload.room : undefined;
      if (room !== undefined && typeof room !== 'string') return; // malformed payload
      const cleanRoom = normalizeRoomName(room) || 'general';
      const cleanName = socket.data.username; // from verified JWT, not client input
      if (!cleanName) return;
      // Rate limit before join work: bounded attempts per user (bcrypt for
      // password rooms is the expensive part).
      if (!bucketFor(joinBuckets, cleanName, JOIN_BURST, JOIN_REFILL_PER_SEC)()) {
        socket.emit('join_rate_limited', { room: cleanRoom, retryAfter: 5 });
        return;
      }

      // Rooms are private to their members (see rooms.js). #general is open,
      // and legacy rooms (chat history but no Room doc yet) register on their
      // first join — joinRoom enforces the password for everything else.
      if (!(await isMember(cleanRoom, cleanName))) {
        const res = await joinRoom(cleanRoom, '', cleanName);
        if (res.error) {
          // A denied room switch must not leave the socket subscribed to the
          // previous room, where it could continue receiving private events.
          const previous = users.get(socket.id);
          if (previous) {
            socket.leave(previous.room);
            users.delete(socket.id);
            socket.to(previous.room).emit('user_typing', { username: cleanName, isTyping: false });
            const stillHere = [...users.values()].some(
              (x) => x.room === previous.room && x.username === cleanName
            );
            if (!stillHere) io.to(previous.room).emit('user_left', { username: cleanName });
            io.to(previous.room).emit('room_users', getRoomUsers(previous.room));
          }
          socket.emit('join_denied', { room: cleanRoom });
          return;
        }
      }

      // Async membership checks can resolve after a newer switch or after a
      // disconnect; stale joins must never recreate online presence.
      if (socket.data.disconnected || joinRevision !== socket.data.joinRevision) return;

      const prev = users.get(socket.id);

      // Moving rooms on one socket: unsubscribe from the old room and let it
      // refresh — otherwise it keeps showing this user as online after they left.
      if (prev && prev.room !== cleanRoom) {
        socket.leave(prev.room);
        socket.to(prev.room).emit('user_typing', { username: cleanName, isTyping: false });
        const stillInOldRoom = [...users.entries()].some(
          ([id, x]) => id !== socket.id && x.room === prev.room && x.username === cleanName
        );
        if (!stillInOldRoom) io.to(prev.room).emit('user_left', { username: cleanName });
        io.to(prev.room).emit('room_users', getRoomUsers(prev.room));
      }

      const firstSocketForUser = ![...users.values()].some(
        (x) => x.room === cleanRoom && x.username === cleanName
      );
      socket.join(cleanRoom);
      users.set(socket.id, { username: cleanName, room: cleanRoom });

      // send history to just-joined user (MongoDB if connected, else memory)
      try {
        const history = await loadHistory(cleanRoom);
        if (socket.data.disconnected || joinRevision !== socket.data.joinRevision) return;
        socket.emit('message_history', history);
      } catch {
        socket.emit('history_error', { room: cleanRoom });
      }

      // notify room (only when this user isn't already present via another tab/socket)
      if (firstSocketForUser) socket.to(cleanRoom).emit('user_joined', { username: cleanName });
      io.to(cleanRoom).emit('room_users', getRoomUsers(cleanRoom));
    }));

    socket.on('send_message', safeHandler(async (payload) => {
      const { room, text } = payload && typeof payload === 'object' ? payload : {};
      if (room !== undefined && typeof room !== 'string') return; // malformed payload
      if (typeof text !== 'string') return; // non-strings can't be messages
      const cleanRoom = normalizeRoomName(room) || 'general';
      const cleanText = text.trim();
      if (!cleanText) return;
      // Rate limit before the membership lookup: bounded sends per user.
      if (!bucketFor(messageBuckets, socket.data.username, MESSAGE_BURST, MESSAGE_REFILL_PER_SEC)()) {
        socket.emit('message_error', {
          text: cleanText.slice(0, 1000),
          message: 'You are sending messages too quickly. Wait a moment and try again.'
        });
        return;
      }
      // Members only: keeps password-protected rooms private end to end.
      let authorized;
      try {
        authorized = await isMember(cleanRoom, socket.data.username);
      } catch {
        socket.emit('message_error', {
          text: cleanText.slice(0, 1000),
          message: 'Room access could not be checked. Please try again.'
        });
        return;
      }
      if (!authorized) {
        socket.emit('message_error', {
          text: cleanText.slice(0, 1000),
          message: 'You no longer have access to this room.'
        });
        return;
      }

      const msg = {
        id: Date.now().toString() + '-' + Math.random().toString(36).slice(2, 7),
        room: cleanRoom,
        username: socket.data.username,
        text: cleanText.slice(0, 1000),
        createdAt: new Date().toISOString()
      };

      if (isDbConfigured() && !isDbReady()) {
        socket.emit('message_error', { text: cleanText, message: 'Message storage is temporarily unavailable. Your message was not sent.' });
        return;
      }
      try {
        await persistMessage(msg);
      } catch (e) {
        console.log('[db] message save failed:', e.message);
        socket.emit('message_error', { text: cleanText, message: 'Message could not be saved. Please try again.' });
        return;
      }
      const arr = getRoomMessages(cleanRoom);
      arr.push(msg);
      if (arr.length > 100) {
        arr.splice(0, arr.length - 100);
        historyEvictedRooms.add(cleanRoom);
      }
      recordActivity(msg);
      io.to(cleanRoom).emit('receive_message', msg);
    }));

    socket.on('typing', safeHandler(async (payload) => {
      const { room, isTyping } = payload && typeof payload === 'object' ? payload : {};
      if (room !== undefined && typeof room !== 'string') return; // malformed payload
      const username = socket.data.username;
      const cleanRoom = normalizeRoomName(room) || 'general';
      if (!chatter()) return; // per-connection chatter cap
      // Same membership gate as send_message: typing must never broadcast
      // into rooms the caller isn't a member of.
      if (!username || !(await isMember(cleanRoom, username))) return;
      socket.to(cleanRoom).emit('user_typing', { username, isTyping: !!isTyping });
    }));

    // Toggle one emoji reaction for the caller on one message, then tell the room.
    socket.on('toggle_reaction', safeHandler(async (payload) => {
      const { room, messageId, emoji } = payload && typeof payload === 'object' ? payload : {};
      if (room !== undefined && typeof room !== 'string') return; // malformed payload
      const cleanRoom = normalizeRoomName(room) || 'general';
      const username = socket.data.username;
      if (!username || typeof messageId !== 'string' || messageId.length > 64) return;
      if (!ALLOWED_REACTIONS.includes(emoji)) return;
      if (!chatter()) return; // per-connection chatter cap
      if (!(await isMember(cleanRoom, username))) return;
      // The message must live in the room the caller was authorized for:
      // this binds reactions to a room, not just to a message id.
      if (!(await messageExistsInRoom(cleanRoom, messageId))) return;

      // With MongoDB connected the message document is the source of truth;
      // mirror the result into the memory store so the emit below reads one
      // consistent state. Messages whose insert is still in flight fall back
      // to the memory toggle, same as when MongoDB is absent.
      let persistedReactions = null;
      if (isDbReady()) {
        persistedReactions = await toggleReactionInDb(cleanRoom, messageId, emoji, username);
        if (persistedReactions) setMemoryReactions(cleanRoom, messageId, persistedReactions);
      }
      if (!persistedReactions) {
        if (isDbConfigured() && isDbReady()) return;
        toggleReactionInMemory(cleanRoom, messageId, emoji, username);
      }

      io.to(cleanRoom).emit('message_reaction', {
        messageId,
        reactions: summarizeReactions(cleanRoom, messageId)
      });
    }));

    socket.on('disconnect', () => {
      socket.data.disconnected = true;
      socket.data.joinRevision += 1;
      const u = users.get(socket.id);
      users.delete(socket.id);
      if (!u) return;
      // Same user may still be here via another tab/socket: presence stays.
      const stillHere = [...users.values()].some(
        (x) => x.room === u.room && x.username === u.username
      );
      if (!stillHere) {
        socket.to(u.room).emit('user_typing', { username: u.username, isTyping: false });
        socket.to(u.room).emit('user_left', { username: u.username });
      }
      io.to(u.room).emit('room_users', getRoomUsers(u.room));
    });
  });
}
