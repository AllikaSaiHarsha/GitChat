// Room registry: who is a member of which room + per-room join passwords.
// MongoDB is the durable store; `roomStore` is a write-through cache that
// also doubles as the fallback when MongoDB is unavailable (like messageStore).
import bcrypt from 'bcryptjs';
import { Room } from './models/Room.js';
import { Message } from './models/Message.js';
import { isDbReady } from './db.js';
import { dummyCompare } from './auth.js';

export const DEFAULT_ROOM = 'general';

// name -> { passwordHash, createdBy, members: Set<string> }
export const roomStore = new Map();

// "My Room!" -> "my-room". Keeps room names URL/socket friendly.
export function normalizeRoomName(raw) {
  return (raw || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-_]/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 30);
}

function mirror(doc) {
  roomStore.set(doc.name, {
    passwordHash: doc.passwordHash || null,
    createdBy: doc.createdBy || '',
    members: new Set(doc.members || [])
  });
}

// Cache first; ask MongoDB only for rooms not seen yet this server run.
async function getRoom(name) {
  const cached = roomStore.get(name);
  if (cached) {
    return {
      name,
      passwordHash: cached.passwordHash,
      createdBy: cached.createdBy,
      members: [...cached.members]
    };
  }
  if (!isDbReady()) return null;
  try {
    const doc = await Room.findOne({ name }).lean();
    if (!doc) return null;
    mirror(doc);
    return {
      name,
      passwordHash: doc.passwordHash || null,
      createdBy: doc.createdBy || '',
      members: doc.members || []
    };
  } catch {
    return null;
  }
}

// Rooms this user belongs to (plus the always-open default room).
// `admin` is true for rooms the user created — they can manage those members.
export async function listRoomsFor(username) {
  const map = new Map();
  map.set(DEFAULT_ROOM, { name: DEFAULT_ROOM, locked: false, admin: false });
  for (const [name, r] of roomStore) {
    if (r.members.has(username)) {
      map.set(name, { name, locked: !!r.passwordHash, admin: r.createdBy === username });
    }
  }
  if (isDbReady()) {
    try {
      const docs = await Room.find({ members: username }).lean();
      for (const d of docs) {
        map.set(d.name, { name: d.name, locked: !!d.passwordHash, admin: d.createdBy === username });
      }
    } catch {
      /* fall back to what the cache knows */
    }
  }
  return [...map.values()].sort((a, b) => {
    if (a.name === DEFAULT_ROOM) return -1;
    if (b.name === DEFAULT_ROOM) return 1;
    return a.name.localeCompare(b.name);
  });
}

export async function isMember(name, username) {
  if (!username) return false;
  if (name === DEFAULT_ROOM) return true;
  const room = await getRoom(name);
  return !!room && room.members.includes(username);
}

// The creator of a room is its admin and can manage the member list.
export async function isAdmin(name, username) {
  if (!username || name === DEFAULT_ROOM) return false;
  const room = await getRoom(name);
  return !!room && room.createdBy === username;
}

// Members + admin of a room (drives the member-management panel).
export async function roomMembers(name) {
  const room = await getRoom(name);
  if (!room) return { members: [], createdBy: '' };
  return { members: room.members, createdBy: room.createdBy };
}

// Add the user to both the durable store and the cache.
export async function addMember(name, username) {
  const cached = roomStore.get(name);
  if (cached) cached.members.add(username);
  if (isDbReady()) {
    try {
      await Room.updateOne({ name }, { $addToSet: { members: username } });
    } catch (e) {
      console.log('[rooms] membership save failed:', e.message);
    }
  }
}

// Remove a member (admin action). The creator is never removed.
export async function removeMember(name, username) {
  const cached = roomStore.get(name);
  if (cached) cached.members.delete(username);
  if (isDbReady()) {
    try {
      await Room.updateOne({ name }, { $pull: { members: username } });
    } catch (e) {
      console.log('[rooms] membership removal failed:', e.message);
    }
  }
}

// Rooms that only exist as message history (created before memberships) stay
// joinable by name: the first join registers them as open, passwordless rooms.
async function hasHistory(name) {
  if (roomStore.has(name)) return false;
  if (!isDbReady()) return false;
  try {
    return await Message.exists({ room: name });
  } catch {
    return false;
  }
}

async function registerExisting(name, username) {
  roomStore.set(name, { passwordHash: null, createdBy: username, members: new Set([username]) });
  if (isDbReady()) {
    try {
      await Room.updateOne(
        { name },
        { $setOnInsert: { name, passwordHash: null, createdBy: username, members: [username] } },
        { upsert: true }
      );
    } catch (e) {
      console.log('[rooms] room save failed:', e.message);
    }
  }
}

export async function createRoom(rawName, password, creator) {
  const name = normalizeRoomName(rawName);
  if (name.length < 2) {
    return { error: 'Room names need at least 2 letters or numbers.', status: 400 };
  }
  if (name === DEFAULT_ROOM) {
    return { error: '#general already exists — just join it.', status: 400 };
  }
  if (!password || password.length < 4) {
    return { error: 'Room passwords need at least 4 characters.', status: 400 };
  }
  if (await getRoom(name)) {
    return { error: `#${name} already exists — try joining it instead.`, status: 409 };
  }

  const passwordHash = await bcrypt.hash(password, 10);
  roomStore.set(name, { passwordHash, createdBy: creator, members: new Set([creator]) });
  if (isDbReady()) {
    try {
      await Room.create({ name, passwordHash, createdBy: creator, members: [creator] });
    } catch (e) {
      if (e.code === 11000) {
        roomStore.delete(name);
        return { error: `#${name} already exists — try joining it instead.`, status: 409 };
      }
      console.log('[rooms] room save failed:', e.message);
    }
  }
  return { room: name };
}

export async function joinRoom(rawName, password, username) {
  const name = normalizeRoomName(rawName);
  if (!name) return { error: 'Enter a room name.', status: 400 };
  if (name === DEFAULT_ROOM) return { room: name };

  const room = await getRoom(name);
  if (!room) {
    if (await hasHistory(name)) {
      await registerExisting(name, username);
      return { room: name };
    }
    // Uniform timing: a missing room must cost the same as a wrong password,
    // or the identical join_denied payload leaks room existence.
    await dummyCompare(password);
    return { error: `No room named #${name} — check the spelling, or create it.`, status: 404 };
  }

  // Already a member: the password was a one-time thing at the first join.
  if (room.members.includes(username)) return { room: name };

  if (room.passwordHash) {
    const ok = await bcrypt.compare(password || '', room.passwordHash);
    if (!ok) return { error: `Wrong password for #${name}.`, status: 401 };
  }
  await addMember(name, username);
  return { room: name };
}
