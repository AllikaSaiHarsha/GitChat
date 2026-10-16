import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRightIcon, LockIcon, PlusIcon } from '@primer/octicons-react';
import Avatar from './Avatar.jsx';

const listItem = {
  initial: { opacity: 0, x: -10 },
  animate: { opacity: 1, x: 0, transition: { duration: 0.18, ease: 'easeOut' } },
  exit: { opacity: 0, x: -10, transition: { duration: 0.14, ease: 'easeIn' } }
};

// Repo-file-browser style sidebar: the rooms you're a member of, shortcuts to
// create/join more (they live in the lobby), and who is online. Collapses to
// an icon rail (see .sidebar.collapsed).
export default function Sidebar({ username, room, rooms, onlineUsers, onSelectRoom, onOpenRoomHub, collapsed }) {
  // Your own rooms (you're the admin) listed separately from joined ones.
  const adminRooms = rooms.filter((r) => r.admin);
  const memberRooms = rooms.filter((r) => !r.admin);

  const roomButton = (r) => {
    const active = r.name === room;
    return (
      <button
        key={r.name}
        type="button"
        className={active ? 'tree-item tree-btn active' : 'tree-item tree-btn'}
        title={active ? `#${r.name} (current)` : `Go to #${r.name}`}
        onClick={() => !active && onSelectRoom(r.name)}
      >
        <span className="tree-icon" aria-hidden="true">#</span>
        <span className="tree-name">{r.name}</span>
        {r.admin && <span className="badge accent">admin</span>}
        {r.locked && (
          <span className="tree-lock" title="Password protected">
            <LockIcon size={12} />
          </span>
        )}
      </button>
    );
  };

  return (
    <aside className={collapsed ? 'sidebar collapsed' : 'sidebar'}>
      <nav className="sidebar-scroll">
        {adminRooms.length > 0 && (
          <section className="sidebar-section">
            <h3 className="sidebar-label">Created by you</h3>
            {adminRooms.map(roomButton)}
          </section>
        )}

        <section className="sidebar-section">
          <h3 className="sidebar-label">Your rooms</h3>
          {memberRooms.map(roomButton)}
          {rooms.length === 0 && <div className="tree-item empty">Loading rooms…</div>}
        </section>

        <section className="sidebar-section">
          <button
            type="button"
            className="tree-item tree-btn new-room"
            title="Create a new room"
            onClick={onOpenRoomHub}
          >
            <span className="tree-icon" aria-hidden="true">
              <PlusIcon size={14} />
            </span>
            <span className="tree-name">Create a room…</span>
          </button>
          <button
            type="button"
            className="tree-item tree-btn new-room"
            title="Join a room with its password"
            onClick={onOpenRoomHub}
          >
            <span className="tree-icon" aria-hidden="true">
              <ArrowRightIcon size={14} />
            </span>
            <span className="tree-name">Join a room…</span>
          </button>
        </section>

        <section className="sidebar-section">
          <h3 className="sidebar-label">
            Online
            <span className="label-count">{onlineUsers.length}</span>
          </h3>
          <AnimatePresence initial={false}>
            {onlineUsers.map((u) => (
              <motion.div
                key={u}
                layout
                className="tree-item"
                variants={listItem}
                initial="initial"
                animate="animate"
                exit="exit"
              >
                <span className="presence-dot" aria-hidden="true" />
                <Avatar name={u} size={20} own={u === username} />
                <span className="tree-name">{u}</span>
                {u === username && <span className="badge">you</span>}
              </motion.div>
            ))}
          </AnimatePresence>
          {onlineUsers.length === 0 && <div className="tree-item empty">No one online</div>}
        </section>
      </nav>
    </aside>
  );
}
