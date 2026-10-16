// Activity stats for the "Catch me up" panel (GitHub-style heatmap).
// Returns per-day message counts for the room and for one user,
// over a rolling 12-week window. Mongo when connected, else memory.
import { isDbReady } from './db.js';
import { Message } from './models/Message.js';
import { messageStore } from './socket.js';

const WINDOW_DAYS = 84;

function dayKey(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export async function getActivity(room, username) {
  const cleanRoom = (room || 'general').trim() || 'general';
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

  let rows;
  if (isDbReady()) {
    rows = await Message.find({ room: cleanRoom, createdAt: { $gte: since } })
      .select('username createdAt')
      .lean();
  } else {
    rows = (messageStore.get(cleanRoom) || []).filter(
      (m) => new Date(m.createdAt).getTime() >= since.getTime()
    );
  }

  const days = {}; // room-wide counts per day
  const mineDays = {}; // this user's counts per day
  for (const m of rows) {
    const key = dayKey(m.createdAt);
    if (!key) continue;
    days[key] = (days[key] || 0) + 1;
    if (m.username === username) mineDays[key] = (mineDays[key] || 0) + 1;
  }

  return { room: cleanRoom, windowDays: WINDOW_DAYS, days, mineDays };
}
