import { Fragment, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { LockIcon, PeopleIcon, SyncIcon } from '@primer/octicons-react';
import { getSocket } from '../hooks/useSocket.js';
import { getToken, fetchHistory, fetchActivity } from '../lib/auth.js';
import Sidebar from './Sidebar.jsx';
import MessageRow from './MessageRow.jsx';
import Composer from './Composer.jsx';
import CatchUpPanel from './CatchUpPanel.jsx';
import MembersPanel from './MembersPanel.jsx';
import GitChatLogo from './GitChatLogo.jsx';

// Messages stagger in on mount, like GitHub loading a timeline.
const listVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.045, delayChildren: 0.03 } }
};

export default function Chat({ username, room, rooms, onLogout, catchUpRequest, onSelectRoom, onOpenRoomHub, onRefreshRooms, sidebarCollapsed }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [typingUsers, setTypingUsers] = useState(new Set());
  const [historyReady, setHistoryReady] = useState(false);
  const [reactionsById, setReactionsById] = useState({});
  const [dividerId, setDividerId] = useState(null);
  const [highlightId, setHighlightId] = useState(null);
  const [catchUpOpen, setCatchUpOpen] = useState(false);
  const [catchUpAnchor, setCatchUpAnchor] = useState('');
  const [activity, setActivity] = useState(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [lastSeenAt, setLastSeenAt] = useState('');
  const [accessDenied, setAccessDenied] = useState(null); // { room, removed? } or null
  const [membersOpen, setMembersOpen] = useState(false);
  const [connected, setConnected] = useState(true); // false while the socket is down
  const bottomRef = useRef(null);
  const typingTimeout = useRef(null);
  const highlightTimer = useRef(null);
  const handledCatchUp = useRef(0);
  // Last-visit anchor: read once per room. StrictMode dev double-mounts the
  // effect (run #1's cleanup writes the key), so run #2 must not re-read it.
  const lastSeenInit = useRef({ room: null, value: '' });

  useEffect(() => {
    const token = getToken();
    const socket = getSocket(token);
    const lastSeenKey = 'chat:lastseen:' + room;
    let storedLastSeen = '';
    try {
      storedLastSeen = localStorage.getItem(lastSeenKey) || '';
    } catch {
      storedLastSeen = '';
    }
    if (lastSeenInit.current.room !== room) {
      lastSeenInit.current = { room, value: storedLastSeen };
    }
    const prevVisitAt = lastSeenInit.current.value;

    // Fresh room (or user): reset everything, then recompute per-room state.
    setMessages([]);
    setReactionsById({});
    setDividerId(null);
    setHistoryReady(false);
    setOnlineUsers([]);
    setTypingUsers(new Set());
    setLastSeenAt(prevVisitAt);
    setCatchUpOpen(false);
    setAccessDenied(null);
    setMembersOpen(false);

    // Join — and re-join after every reconnect. Without this, a reconnected
    // socket sits in no room and silently stops receiving messages/reactions.
    const joinNow = () => socket.emit('join_room', { room });
    const onConnect = () => {
      setConnected(true);
      joinNow();
    };
    const onDisconnect = () => setConnected(false);
    if (socket.connected) joinNow();
    else socket.connect();
    setConnected(socket.connected);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    // "New" divider: first message after your previous visit to this room.
    const placeDivider = (list) => {
      if (!prevVisitAt || !Array.isArray(list)) return;
      const anchor = new Date(prevVisitAt).getTime();
      const first = list.find(
        (m) => m.username !== 'system' && new Date(m.createdAt).getTime() > anchor
      );
      if (first) setDividerId((prev) => prev || first.id);
    };

    // Pull reactions that ride along with history payloads.
    const collectReactions = (list) => {
      if (!Array.isArray(list)) return;
      const map = {};
      for (const m of list) {
        if (m && Array.isArray(m.reactions) && m.reactions.length) map[m.id] = m.reactions;
      }
      if (Object.keys(map).length) setReactionsById((prev) => ({ ...map, ...prev }));
    };

    // Skeletons never linger: show them until history lands (or 2.5s max)
    const historyFallback = setTimeout(() => setHistoryReady(true), 2500);

    // Fallback: authed REST history in case socket history missed
    fetchHistory(room, token)
      .then((data) => {
        if (Array.isArray(data) && data.length) {
          setMessages((prev) => (prev.length ? prev : data));
          collectReactions(data);
          placeDivider(data);
        }
      })
      .catch((e) => {
        if (e.message === 'unauthorized') onLogout?.();
      })
      .finally(() => setHistoryReady(true));

    const onHistory = (msgs) => {
      if (Array.isArray(msgs)) {
        setMessages(msgs);
        collectReactions(msgs);
        placeDivider(msgs);
      }
      setHistoryReady(true);
    };
    const onReceive = (msg) => setMessages((prev) => [...prev.slice(-99), msg]);
    const onReaction = ({ messageId, reactions }) => {
      if (!messageId) return;
      setReactionsById((prev) => ({ ...prev, [messageId]: Array.isArray(reactions) ? reactions : [] }));
    };
    const onUsers = (list) => setOnlineUsers(list || []);
    const onJoined = ({ username: u }) =>
      setMessages((prev) => [...prev.slice(-99), {
        id: 'sys-' + Date.now(),
        username: 'system',
        text: `${u} joined`,
        createdAt: new Date().toISOString()
      }]);
    const onLeft = ({ username: u }) =>
      setMessages((prev) => [...prev.slice(-99), {
        id: 'sys-' + Date.now(),
        username: 'system',
        text: `${u} left`,
        createdAt: new Date().toISOString()
      }]);
    const onTyping = ({ username: u, isTyping }) => {
      setTypingUsers((prev) => {
        const next = new Set(prev);
        if (isTyping) next.add(u);
        else next.delete(u);
        return next;
      });
    };
    const onConnectError = (err) => {
      if (err?.message?.includes('unauthorized')) onLogout?.();
    };
    // Server refused the join: this account isn't a member of the room.
    const onDenied = ({ room: denied }) => setAccessDenied({ room: denied || room });
    // Membership ended while we were inside: admin removal or our own leave.
    const onRemoved = ({ room: removed, reason }) => {
      setAccessDenied({ room: removed || room, removed: reason !== 'left', left: reason === 'left' });
      onRefreshRooms?.();
    };

    socket.on('message_history', onHistory);
    socket.on('receive_message', onReceive);
    socket.on('message_reaction', onReaction);
    socket.on('room_users', onUsers);
    socket.on('user_joined', onJoined);
    socket.on('user_left', onLeft);
    socket.on('user_typing', onTyping);
    socket.on('connect_error', onConnectError);
    socket.on('join_denied', onDenied);
    socket.on('removed_from_room', onRemoved);

    return () => {
      clearTimeout(historyFallback);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('message_history', onHistory);
      socket.off('receive_message', onReceive);
      socket.off('message_reaction', onReaction);
      socket.off('room_users', onUsers);
      socket.off('user_joined', onJoined);
      socket.off('user_left', onLeft);
      socket.off('user_typing', onTyping);
      socket.off('connect_error', onConnectError);
      socket.off('join_denied', onDenied);
      socket.off('removed_from_room', onRemoved);
      // remember this visit so next time we can show what you missed
      try {
        localStorage.setItem(lastSeenKey, new Date().toISOString());
      } catch {
        /* storage unavailable: skip */
      }
      socket.disconnect();
    };
  }, [username, room]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => () => clearTimeout(highlightTimer.current), []);

  const openCatchUp = () => {
    setMembersOpen(false);
    setCatchUpAnchor(lastSeenAt);
    const nowIso = new Date().toISOString();
    setLastSeenAt(nowIso);
    try {
      localStorage.setItem('chat:lastseen:' + room, nowIso);
    } catch {
      /* storage unavailable: skip */
    }
    setCatchUpOpen(true);
    setActivityLoading(true);
    fetchActivity(room, getToken())
      .then((data) => setActivity(data))
      .catch(() => setActivity({ days: {}, mineDays: {} }))
      .finally(() => setActivityLoading(false));
  };

  // Triggered from the command palette ("Catch me up").
  useEffect(() => {
    if (catchUpRequest && catchUpRequest !== handledCatchUp.current) {
      handledCatchUp.current = catchUpRequest;
      openCatchUp();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catchUpRequest]);

  const jumpTo = (id) => {
    setCatchUpOpen(false);
    setHighlightId(id);
    clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlightId((h) => (h === id ? null : h)), 2000);
    requestAnimationFrame(() => {
      document.getElementById('msg-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };

  const react = (messageId, emoji) => {
    getSocket().emit('toggle_reaction', { room, messageId, emoji });
  };

  const send = () => {
    const text = input.trim();
    if (!text || !connected) return;
    getSocket().emit('send_message', { room, text });
    setInput('');
    getSocket().emit('typing', { room, isTyping: false });
  };

  const handleTyping = (v) => {
    setInput(v);
    const socket = getSocket();
    socket.emit('typing', { room, isTyping: true });
    clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => {
      socket.emit('typing', { room, isTyping: false });
    }, 1000);
  };

  const othersTyping = [...typingUsers].filter((u) => u !== username);
  // Rooms you created come with admin powers (manage members).
  const isAdmin = !!(rooms || []).find((r) => r.name === room)?.admin;

  return (
    <div className="chat-layout">
      <Sidebar
        username={username}
        room={room}
        rooms={rooms}
        onlineUsers={onlineUsers}
        onSelectRoom={onSelectRoom}
        onOpenRoomHub={onOpenRoomHub}
        collapsed={sidebarCollapsed}
      />

      <main className="chat-main">
        <header className="chat-header">
          <h2 className="room-name">
            <span className="room-hash" aria-hidden="true">#</span>
            <span className="room-text">{room}</span>
          </h2>
          {isAdmin && (
            <motion.button
              whileTap={{ scale: 0.97 }}
              type="button"
              className="ghost catchup-btn"
              title="Manage the members of this room"
              onClick={() => {
                setCatchUpOpen(false);
                setMembersOpen(true);
              }}
            >
              <PeopleIcon size={14} />
              <span className="catchup-btn-label">Members</span>
            </motion.button>
          )}
          <motion.button
            whileTap={{ scale: 0.97 }}
            type="button"
            className="ghost catchup-btn"
            title="Recap what you missed"
            onClick={openCatchUp}
          >
            <SyncIcon size={14} />
            <span className="catchup-btn-label">Catch me up</span>
          </motion.button>
          <motion.span
            key={onlineUsers.length}
            className="count-badge"
            initial={{ scale: 0.85, opacity: 0.5 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          >
            {onlineUsers.length} online
          </motion.span>
        </header>

        <AnimatePresence>
          {!connected && (
            <motion.div
              className="reconnect-banner"
              role="status"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.15 }}
            >
              <span className="reconnect-dot" aria-hidden="true" />
              Reconnecting — sending is paused until the connection is back.
            </motion.div>
          )}
        </AnimatePresence>

        {accessDenied && (
          <div className="access-banner" role="alert">
            <LockIcon size={14} />
            <span>
              {accessDenied.left ? (
                <>
                  You left <strong>#{accessDenied.room}</strong> — rejoin anytime with its password.
                </>
              ) : accessDenied.removed ? (
                <>
                  You were removed from <strong>#{accessDenied.room}</strong> by its admin.
                </>
              ) : (
                <>
                  <strong>#{accessDenied.room}</strong> is private — this account isn't a member of it.
                </>
              )}
            </span>
            <button type="button" className="ghost" onClick={onOpenRoomHub}>
              Your rooms
            </button>
          </div>
        )}

        <motion.div className="messages" variants={listVariants} initial="hidden" animate="show">
          {!historyReady && messages.length === 0 && (
            <div className="skeleton-wrap" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="comment skeleton" style={{ animationDelay: `${i * 150}ms` }}>
                  <div className="skeleton-header">
                    <span className="skeleton-circle" />
                    <span className="skeleton-bar" style={{ width: 92 }} />
                    <span className="skeleton-bar skeleton-dim" style={{ width: 58 }} />
                  </div>
                  <div className="skeleton-body">
                    <span className="skeleton-bar" style={{ width: `${62 - i * 9}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
          {historyReady && messages.length === 0 && (
            <motion.div
              className="empty-state"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
            >
              <span className="empty-icon" aria-hidden="true">
                <GitChatLogo size={26} />
              </span>
              <h3 className="empty-title">Welcome to #{room}</h3>
              <p className="empty-text">
                This is the start of the room. Send the first message — everyone who joins later will see it.
              </p>
              <motion.button
                whileTap={{ scale: 0.98 }}
                type="button"
                onClick={() => document.getElementById('composer-input')?.focus()}
              >
                Say hello
              </motion.button>
            </motion.div>
          )}
          {messages.map((m) => (
            <Fragment key={m.id}>
              {m.id === dividerId && (
                <div className="new-divider" aria-label="New messages">
                  <span>New</span>
                </div>
              )}
              <MessageRow
                message={m}
                own={m.username === username}
                me={username}
                reactions={reactionsById[m.id] || []}
                onReact={react}
                highlighted={highlightId === m.id}
              />
            </Fragment>
          ))}
          <div ref={bottomRef} />
        </motion.div>

        <div className="typing" aria-live="polite">
          <AnimatePresence mode="wait">
            {othersTyping.length > 0 && (
              <motion.span
                key={othersTyping.join(',')}
                className="typing-line"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -2 }}
                transition={{ duration: 0.15 }}
              >
                <span className="typing-dots" aria-hidden="true">
                  {[0, 1, 2].map((i) => (
                    <motion.span
                      key={i}
                      className="typing-dot"
                      animate={{ y: [0, -3, 0], opacity: [0.35, 1, 0.35] }}
                      transition={{ duration: 0.9, repeat: Infinity, ease: 'easeInOut', delay: i * 0.12 }}
                    />
                  ))}
                </span>
                {othersTyping.join(', ')} typing
              </motion.span>
            )}
          </AnimatePresence>
        </div>

        <Composer
          value={input}
          offline={!connected}
          onChange={(e) => handleTyping(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          onSend={send}
        />

        <AnimatePresence>
          {membersOpen && isAdmin && (
            <MembersPanel
              me={username}
              room={room}
              onlineUsers={onlineUsers}
              onClose={() => setMembersOpen(false)}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {catchUpOpen && (
            <CatchUpPanel
              me={username}
              room={room}
              messages={messages}
              lastSeenAt={catchUpAnchor}
              activity={activity}
              loading={activityLoading}
              onClose={() => setCatchUpOpen(false)}
              onJump={jumpTo}
            />
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
