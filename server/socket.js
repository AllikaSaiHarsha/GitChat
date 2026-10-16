// In-memory store: room -> [{ id, room, username, text, createdAt }]
// Capped at 100 messages per room. Used as fallback when MongoDB is down,
// and as a hot cache alongside it.
import { Message } from './models/Message.js';
import { isDbReady } from './db.js';
import { isMember, joinRoom, normalizeRoomName } from './rooms.js';

export const messageStore = new Map();
export const users = new Map(); // socket.id -> { username, room }

// Reactions: messageId -> Map(emoji -> Set(username)).
// In-memory on purpose (lightweight social signals; resets with the server).
export const reactionStore = new Map();
export const ALLOWED_REACTIONS = ['👍', '👎', '😄', '🎉', '😕', '❤️', '🚀', '👀'];

// [{ emoji, users: [names] }] for one message (empty array when none).
export function summarizeReactions(messageId) {
  const byEmoji = reactionStore.get(messageId);
  if (!byEmoji) return [];
  return [...byEmoji.entries()].map(([emoji, names]) => ({ emoji, users: [...names] }));
}

function getRoomMessages(room) {
  if (!messageStore.has(room)) messageStore.set(room, []);
  return messageStore.get(room);
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
  return list.map((m) => ({ ...m, reactions: summarizeReactions(m.id) }));
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

export function setupSocket(io) {
  io.on('connection', (socket) => {
    // console.log('connected:', socket.id);

    socket.on('join_room', async ({ room }) => {
      const cleanRoom = normalizeRoomName(room) || 'general';
      const cleanName = socket.data.username; // from verified JWT, not client input
      if (!cleanName) return;

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
    });

    socket.on('send_message', async ({ room, text }) => {
      const cleanRoom = (room || 'general').trim() || 'general';
      const cleanText = (text || '').trim();
      if (!cleanText) return;
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
    });

    socket.on('typing', ({ room, isTyping }) => {
      const cleanRoom = (room || 'general').trim() || 'general';
      socket.to(cleanRoom).emit('user_typing', { username: socket.data.username, isTyping: !!isTyping });
    });

    // Toggle one emoji reaction for the caller on one message, then tell the room.
    socket.on('toggle_reaction', async ({ room, messageId, emoji }) => {
      const cleanRoom = (room || 'general').trim() || 'general';
      const username = socket.data.username;
      if (!username || typeof messageId !== 'string' || messageId.length > 64) return;
      if (!ALLOWED_REACTIONS.includes(emoji)) return;
      if (!(await isMember(cleanRoom, username))) return;

      let byEmoji = reactionStore.get(messageId);
      if (!byEmoji) {
        byEmoji = new Map();
        reactionStore.set(messageId, byEmoji);
        // keep the map bounded on long-running servers
        if (reactionStore.size > 500) reactionStore.delete(reactionStore.keys().next().value);
      }
      let names = byEmoji.get(emoji);
      if (!names) {
        names = new Set();
        byEmoji.set(emoji, names);
      }
      if (names.has(username)) names.delete(username);
      else names.add(username);
      if (!names.size) byEmoji.delete(emoji);
      if (!byEmoji.size) reactionStore.delete(messageId);

      io.to(cleanRoom).emit('message_reaction', {
        messageId,
        reactions: summarizeReactions(messageId)
      });
    });

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
