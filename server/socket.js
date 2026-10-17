// In-memory store: room -> [{ id, room, username, text, createdAt }]
// Capped at 100 messages per room. Used as fallback when MongoDB is down,
// and as a hot cache alongside it.
import { Message } from './models/Message.js';
import { isDbReady } from './db.js';
import { isMember, joinRoom, normalizeRoomName } from './rooms.js';

export const messageStore = new Map();
export const users = new Map(); // socket.id -> { username, room }

// Reactions: room -> messageId -> Map(emoji -> Set(username)).
// Per-room so events in one room can never read or mutate another room's
// entries by message id. In-memory on purpose (lightweight social signals;
// resets with the server); each room's slice is capped.
export const reactionStore = new Map();
export const ALLOWED_REACTIONS = ['👍', '👎', '😄', '🎉', '😕', '❤️', '🚀', '👀'];
const REACTION_ROOM_CAP = 500;

// [{ emoji, users: [names] }] for one message of one room (empty when none).
export function summarizeReactions(room, messageId) {
  const byEmoji = reactionStore.get(room)?.get(messageId);
  if (!byEmoji) return [];
  return [...byEmoji.entries()].map(([emoji, names]) => ({ emoji, users: [...names] }));
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
    return !!(await Message.exists({ mid: messageId, room }));
  } catch {
    return false;
  }
}

// Last 100 messages, oldest first. MongoDB when connected, else memory.
// Reactions are merged in at read time (they live in reactionStore).
export async function loadHistory(room) {
  let list;
  if (isDbReady()) {
    const docs = await Message.find({ room }).sort({ createdAt: 1 }).limit(100).lean();
    list = docs.map((d) => ({
      id: d.mid || d._id.toString(),
      room: d.room,
      username: d.username,
      text: d.text,
      createdAt: d.createdAt.toISOString()
    }));
  } else {
    list = getRoomMessages(room);
  }
  return list.map((m) => ({ ...m, reactions: summarizeReactions(room, m.id) }));
}

function persistMessage(msg) {
  if (!isDbReady()) return;
  Message.create({ mid: msg.id, room: msg.room, username: msg.username, text: msg.text }).catch((e) =>
    console.log('[db] message save failed:', e.message)
  );
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
    // console.log('connected:', socket.id);

    socket.on('join_room', safeHandler(async (payload) => {
      const room = payload && typeof payload === 'object' ? payload.room : undefined;
      if (room !== undefined && typeof room !== 'string') return; // malformed payload
      const cleanRoom = normalizeRoomName(room) || 'general';
      const cleanName = socket.data.username; // from verified JWT, not client input
      if (!cleanName) return;
      // Rate limit before join work: bounded attempts per user (bcrypt for
      // password rooms is the expensive part).
      if (!bucketFor(joinBuckets, cleanName, JOIN_BURST, JOIN_REFILL_PER_SEC)()) return;

      // Rooms are private to their members (see rooms.js). #general is open,
      // and legacy rooms (chat history but no Room doc yet) register on their
      // first join — joinRoom enforces the password for everything else.
      if (!(await isMember(cleanRoom, cleanName))) {
        const res = await joinRoom(cleanRoom, '', cleanName);
        if (res.error) {
          socket.emit('join_denied', { room: cleanRoom });
          return;
        }
      }

      const prev = users.get(socket.id);

      // Moving rooms on one socket: unsubscribe from the old room and let it
      // refresh — otherwise it keeps showing this user as online after they left.
      if (prev && prev.room !== cleanRoom) {
        socket.leave(prev.room);
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
        socket.emit('message_history', await loadHistory(cleanRoom));
      } catch {
        socket.emit('message_history', getRoomMessages(cleanRoom));
      }

      // notify room (only when this user isn't already present via another tab/socket)
      if (firstSocketForUser) socket.to(cleanRoom).emit('user_joined', { username: cleanName });
      io.to(cleanRoom).emit('room_users', getRoomUsers(cleanRoom));
    }));

    socket.on('send_message', safeHandler(async (payload) => {
      const { room, text } = payload && typeof payload === 'object' ? payload : {};
      if (room !== undefined && typeof room !== 'string') return; // malformed payload
      if (typeof text !== 'string') return; // non-strings can't be messages
      const cleanRoom = (room || 'general').trim() || 'general';
      const cleanText = text.trim();
      if (!cleanText) return;
      // Rate limit before the membership lookup: bounded sends per user.
      if (!bucketFor(messageBuckets, socket.data.username, MESSAGE_BURST, MESSAGE_REFILL_PER_SEC)()) return;
      // Members only: keeps password-protected rooms private end to end.
      if (!(await isMember(cleanRoom, socket.data.username))) return;

      const msg = {
        id: Date.now().toString() + '-' + Math.random().toString(36).slice(2, 7),
        room: cleanRoom,
        username: socket.data.username,
        text: cleanText.slice(0, 1000),
        createdAt: new Date().toISOString()
      };

      const arr = getRoomMessages(cleanRoom);
      arr.push(msg);
      if (arr.length > 100) arr.splice(0, arr.length - 100);
      persistMessage(msg);

      io.to(cleanRoom).emit('receive_message', msg);
    }));

    socket.on('typing', safeHandler(async (payload) => {
      const { room, isTyping } = payload && typeof payload === 'object' ? payload : {};
      if (room !== undefined && typeof room !== 'string') return; // malformed payload
      const username = socket.data.username;
      const cleanRoom = (room || 'general').trim() || 'general';
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
      const cleanRoom = (room || 'general').trim() || 'general';
      const username = socket.data.username;
      if (!username || typeof messageId !== 'string' || messageId.length > 64) return;
      if (!ALLOWED_REACTIONS.includes(emoji)) return;
      if (!chatter()) return; // per-connection chatter cap
      if (!(await isMember(cleanRoom, username))) return;
      // The message must live in the room the caller was authorized for:
      // this binds reactions to a room, not just to a message id.
      if (!(await messageExistsInRoom(cleanRoom, messageId))) return;

      let roomReactions = reactionStore.get(cleanRoom);
      if (!roomReactions) {
        roomReactions = new Map();
        reactionStore.set(cleanRoom, roomReactions);
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
      if (!roomReactions.size) reactionStore.delete(cleanRoom);

      io.to(cleanRoom).emit('message_reaction', {
        messageId,
        reactions: summarizeReactions(cleanRoom, messageId)
      });
    }));

    socket.on('disconnect', () => {
      const u = users.get(socket.id);
      users.delete(socket.id);
      if (!u) return;
      // Same user may still be here via another tab/socket: presence stays.
      const stillHere = [...users.values()].some(
        (x) => x.room === u.room && x.username === u.username
      );
      if (!stillHere) socket.to(u.room).emit('user_left', { username: u.username });
      io.to(u.room).emit('room_users', getRoomUsers(u.room));
    });
  });
}
