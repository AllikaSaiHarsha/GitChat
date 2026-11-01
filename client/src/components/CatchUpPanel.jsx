import { motion } from 'framer-motion';
import { CheckCircleIcon, GraphIcon, SyncIcon, XIcon } from '@primer/octicons-react';
import Avatar from './Avatar.jsx';

// "Catch me up": a recap of what happened since your last visit
// plus a GitHub-style 12-week activity heatmap for the room.
export default function CatchUpPanel({ me, room, messages, lastSeenAt, activity, loading, onClose, onJump }) {
  const chatMsgs = messages.filter((m) => m.username !== 'system');
  const anchor = lastSeenAt ? new Date(lastSeenAt).getTime() : 0;
  let missed = anchor ? chatMsgs.filter((m) => new Date(m.createdAt).getTime() > anchor) : [];
  if (!anchor) missed = chatMsgs.slice(-25);

  const people = [...new Set(missed.map((m) => m.username))];

  // Most recent message per person, up to 4 people.
  const highlights = [];
  const seenAuthors = new Set();
  for (let i = missed.length - 1; i >= 0 && highlights.length < 4; i -= 1) {
    const m = missed[i];
    if (!seenAuthors.has(m.username)) {
      seenAuthors.add(m.username);
      highlights.push(m);
    }
  }

  const days = activity?.days || {};
  const mineDays = activity?.mineDays || {};
  const weeks = buildWeeks(days);
  const myTotal = Object.values(mineDays).reduce((a, b) => a + b, 0);
  const roomTotal = Object.values(days).reduce((a, b) => a + b, 0);
  const best = Object.entries(days).sort((a, b) => b[1] - a[1])[0];
  const streak = streakFrom(mineDays);

  return (
    <motion.aside
      className="catchup-panel"
      role="dialog"
      aria-label="Catch me up"
      initial={{ opacity: 0, y: -8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
    >
      <header className="catchup-head">
        <span className="catchup-title">
          <SyncIcon size={14} />
          Catch me up
        </span>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
          <XIcon size={14} />
        </button>
      </header>

      <p className="catchup-sub">
        {missed.length === 0
          ? `You're all caught up in #${room}.`
          : anchor
            ? `${missed.length} new message${missed.length === 1 ? '' : 's'} from ${people.length} ${
                people.length === 1 ? 'person' : 'people'
              } while you were away.`
            : `Latest activity in #${room}.`}
      </p>

      {highlights.length > 0 ? (
        <div className="catchup-list">
          {highlights.map((m) => (
            <button
              key={m.id}
              type="button"
              className="catchup-item"
              title="Jump to message"
              onClick={() => onJump(m.id)}
            >
              <Avatar name={m.username} size={20} own={m.username === me} />
              <span className="catchup-item-text">
                <span className="catchup-item-name">{m.username}</span>
                <span className="catchup-item-snippet">{m.text}</span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="catchup-empty">
          <CheckCircleIcon size={14} />
          Nothing new to recap
        </div>
      )}

      <div className="catchup-divider">
        <GraphIcon size={13} />
        Your activity · last 12 weeks
      </div>

      {loading ? (
        <div className="heat-skeleton" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <span key={i} className="skeleton-bar" />
          ))}
        </div>
      ) : (
        <>
          <div className="heatmap" aria-label="Message activity heatmap">
            {weeks.map((week, wi) => (
              <div className="heat-col" key={wi}>
                {week.map((cell, di) =>
                  cell ? (
                    <div
                      key={cell.key}
                      className={'heat-cell lv' + level(cell.count)}
                      title={`${cell.count} message${cell.count === 1 ? '' : 's'} on ${cell.key}`}
                    />
                  ) : (
                    <div key={`pad-${wi}-${di}`} className="heat-cell pad" />
                  )
                )}
              </div>
            ))}
          </div>

          <div className="heat-legend">
            <span>Less</span>
            {[0, 1, 2, 3, 4].map((l) => (
              <span key={l} className={'heat-cell small lv' + l} />
            ))}
            <span>More</span>
          </div>

          <div className="stats-row">
            <div className="stat-chip">
              <span className="stat-value">{myTotal}</span>
              <span className="stat-label">your messages</span>
            </div>
            <div className="stat-chip">
              <span className="stat-value">{streak}d</span>
              <span className="stat-label">{streak > 0 ? 'streak' : 'no streak yet'}</span>
            </div>
            <div className="stat-chip">
              <span className="stat-value">{roomTotal}</span>
              <span className="stat-label">room total</span>
            </div>
            {best && (
              <div className="stat-chip">
                <span className="stat-value">{best[1]}</span>
                <span className="stat-label">best day</span>
              </div>
            )}
          </div>
        </>
      )}
    </motion.aside>
  );
}

function level(count) {
  if (!count) return 0;
  if (count >= 10) return 4;
  if (count >= 6) return 3;
  if (count >= 3) return 2;
  return 1;
}

// 12 weeks ending today, columns = weeks, rows = weekdays (GitHub style).
function buildWeeks(days) {
  const today = new Date();
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - 83);

  const cells = [];
  for (let i = 0; i < start.getUTCDay(); i += 1) cells.push(null);
  for (let i = 0; i < 84; i += 1) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    cells.push({ key, count: days[key] || 0 });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

// Consecutive active days ending today (or yesterday, if today is still quiet).
function streakFrom(mineDays) {
  let streak = 0;
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const keyOf = (dt) => dt.toISOString().slice(0, 10);
  if (!mineDays[keyOf(d)]) d.setUTCDate(d.getUTCDate() - 1);
  while (mineDays[keyOf(d)]) {
    streak += 1;
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return streak;
}
