import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { PeopleIcon, XIcon } from '@primer/octicons-react';
import Avatar from './Avatar.jsx';
import { getToken, fetchMembers, addMember, removeMember } from '../lib/auth.js';

// Admin-only panel: the room's member roster with add/remove controls.
// Green dot = here right now (from the room's live presence list).
export default function MembersPanel({ me, room, onlineUsers, onClose }) {
  const [members, setMembers] = useState(null);
  const [createdBy, setCreatedBy] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchMembers(room, getToken())
      .then((d) => {
        if (!alive) return;
        setMembers(d.members || []);
        setCreatedBy(d.createdBy || '');
      })
      .catch(() => {
        if (alive) setMembers([]);
      });
    return () => {
      alive = false;
    };
  }, [room]);

  const apply = (d) => {
    setMembers(d.members || []);
    setCreatedBy(d.createdBy || '');
  };

  const submitAdd = async (e) => {
    e.preventDefault();
    const username = name.trim();
    if (!username || busy) return;
    setBusy(true);
    setError('');
    try {
      apply(await addMember(room, username, getToken()));
      setName('');
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  };

  const kick = async (username) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      apply(await removeMember(room, username, getToken()));
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  };

  const online = new Set(onlineUsers || []);

  return (
    <motion.aside
      className="catchup-panel members-panel"
      role="dialog"
      aria-label={`Members of #${room}`}
      initial={{ opacity: 0, y: -8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
    >
      <header className="catchup-head">
        <span className="catchup-title">
          <PeopleIcon size={14} />
          Members
        </span>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
          <XIcon size={14} />
        </button>
      </header>

      <p className="catchup-sub">
        You're the admin of <strong>#{room}</strong> — add or remove members below.
      </p>

      <form className="member-add" onSubmit={submitAdd}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Add by username"
          aria-label="Username to add"
        />
        <button type="submit" disabled={busy || !name.trim()}>
          Add
        </button>
      </form>

      {error && <p className="error-note member-error">{error}</p>}

      <div className="member-list">
        {members === null && <div className="catchup-empty">Loading members…</div>}
        {members?.map((m) => (
          <div className="member-row" key={m.username}>
            <span className={online.has(m.username) ? 'presence-dot' : 'presence-dot off'} aria-hidden="true" />
            <Avatar name={m.username} size={20} own={m.username === me} />
            <span className="member-name">{m.username}</span>
            {m.username === me && <span className="badge">you</span>}
            {m.username === createdBy && <span className="badge accent">admin</span>}
            {m.username !== createdBy && (
              <button
                type="button"
                className="member-remove"
                title={`Remove ${m.username} from #${room}`}
                aria-label={`Remove ${m.username}`}
                disabled={busy}
                onClick={() => kick(m.username)}
              >
                <XIcon size={14} />
              </button>
            )}
          </div>
        ))}
        {members && members.length === 0 && <div className="catchup-empty">No members yet</div>}
      </div>
    </motion.aside>
  );
}
