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

  const days = {}; // room-wide counts per day
  const mineDays = {}; // this user's counts per day

  if (isDbReady()) {
    // Counted in MongoDB (uses the {room, createdAt} index) so the whole
    // window isn't shipped to the app just to be reduced here.
    const groups = await Message.aggregate([
      { $match: { room: cleanRoom, createdAt: { $gte: since } } },
      {
        $group: {
          _id: {
            day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } },
            mine: { $eq: ['$username', username] }
          },
          count: { $sum: 1 }
        }
      }
    ]);
    for (const g of groups) {
      days[g._id.day] = (days[g._id.day] || 0) + g.count;
      if (g._id.mine) mineDays[g._id.day] = (mineDays[g._id.day] || 0) + g.count;
    }
  } else {
    const sinceMs = since.getTime();
    for (const m of messageStore.get(cleanRoom) || []) {
      if (new Date(m.createdAt).getTime() < sinceMs) continue;
      const key = dayKey(m.createdAt);
      if (!key) continue;
      days[key] = (days[key] || 0) + 1;
      if (m.username === username) mineDays[key] = (mineDays[key] || 0) + 1;
    }
  }

  return { room: cleanRoom, windowDays: WINDOW_DAYS, days, mineDays };
}
