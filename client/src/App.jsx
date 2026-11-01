import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { ArrowLeftIcon, ArrowRightIcon, HashIcon, LockIcon, PlusIcon, SignOutIcon, SyncIcon, XCircleIcon, XIcon } from '@primer/octicons-react';
import Chat from './components/Chat.jsx';
import CommandPalette from './components/CommandPalette.jsx';
import LeaveRoomDialog from './components/LeaveRoomDialog.jsx';
import AppHeader from './components/AppHeader.jsx';
import GitChatLogo from './components/GitChatLogo.jsx';
import Avatar from './components/Avatar.jsx';
import { getToken, clearToken, register, login, fetchMe, fetchRooms, createRoom, joinRoom, leaveRoom } from './lib/auth.js';
import { resetSocket } from './hooks/useSocket.js';

// Stage transition: quick fade + rise, like GitHub page transitions (0.2s ease-out)
const pageVariants = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.22, ease: 'easeOut' } },
  exit: { opacity: 0, y: -6, transition: { duration: 0.14, ease: 'easeIn' } }
};

const errorVariants = {
  initial: { opacity: 0, y: -6 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.18, ease: 'easeOut' } },
  exit: { opacity: 0, y: -6, transition: { duration: 0.12, ease: 'easeIn' } }
};

const popIn = {
  initial: { scale: 0.6, opacity: 0 },
  animate: { scale: 1, opacity: 1, transition: { type: 'spring', stiffness: 380, damping: 22, delay: 0.05 } }
};

const springThumb = { type: 'spring', stiffness: 520, damping: 36 };

export default function App() {
  const [stage, setStage] = useState('checking'); // checking | auth | lobby | chat
  const [mode, setMode] = useState('login'); // login | register
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [joinBusy, setJoinBusy] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [room, setRoom] = useState('general');
  const [error, setError] = useState('');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [catchUpRequest, setCatchUpRequest] = useState(0);

  // Rooms this user is a member of (server truth — everyone is in #general).
  const [rooms, setRooms] = useState([]);
  const [roomsLoading, setRoomsLoading] = useState(true);
  const [roomsError, setRoomsError] = useState('');
  const [joinName, setJoinName] = useState('');
  const [joinPassword, setJoinPassword] = useState('');
  const [joinError, setJoinError] = useState('');
  const [createName, setCreateName] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [createError, setCreateError] = useState('');
  const [pendingLeave, setPendingLeave] = useState(''); // room awaiting leave confirmation
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem('chat:sidebar') === 'collapsed';
    } catch {
      return false;
    }
  });

  const toggleSidebar = () => {
    setSidebarCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem('chat:sidebar', next ? 'collapsed' : 'expanded');
      } catch {
        /* storage unavailable: skip */
      }
      return next;
    });
  };

  // Ctrl/Cmd+K opens the command palette anywhere in the lobby or chat.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Resume session if a valid token is stored. Transient failures (e.g. a
  // reload while the API is still starting) are retried — only a genuine 401
  // signs you out, so a hiccup can never wipe a still-valid stored session.
  useEffect(() => {
    const token = getToken();
    if (!token) {
      setStage('auth');
      return undefined;
    }
    let alive = true;
    let retryTimer;
    let attempts = 0;

    const attempt = () => {
      fetchMe(token)
        .then((me) => {
          if (!alive) return;
          setUsername(me.username);
          setStage('lobby');
        })
        .catch((err) => {
          if (!alive) return;
          if (err.status === 401) {
            clearToken();
            setStage('auth');
            return;
          }
          attempts += 1;
          if (attempts < 5) {
            retryTimer = setTimeout(attempt, 1500);
          } else {
            // Keep the token: a later reload (once the API is back) resumes it.
            setError("Can't reach the server — it may still be starting. Reload to try again.");
            setStage('auth');
          }
        });
    };

    attempt();
    return () => {
      alive = false;
      clearTimeout(retryTimer);
    };
  }, []);

  // The token lives in localStorage, which every tab on this origin shares.
  // If another tab logs in/out, reload so this tab can't keep running with an
  // identity that no longer matches the stored token (that mismatch used to
  // surface as one user's UI driving a socket that reconnected as someone else).
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === 'chat_token') window.location.reload();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const refreshRooms = () => {
    const token = getToken();
    setRoomsLoading(true);
    return fetchRooms(token)
      .then((list) => {
        if (token !== getToken()) return;
        setRooms(list);
        setRoomsError('');
      })
      .catch((err) => {
        if (token === getToken()) setRoomsError(err.message || 'Could not load rooms.');
      })
      .finally(() => {
        if (token === getToken()) setRoomsLoading(false);
      });
  };

  // Keep the room list fresh whenever the lobby or chat appears.
  useEffect(() => {
    if (stage !== 'lobby' && stage !== 'chat') return;
    refreshRooms();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  const submitAuth = async (e) => {
    e?.preventDefault();
    if (authBusy) return;
    setError('');
    setAuthBusy(true);
    try {
      const me = await (mode === 'login' ? login : register)(username.trim(), password);
      setUsername(me.username);
      setPassword('');
      setStage('lobby');
    } catch (e) {
      setError(e.message);
    } finally {
      setAuthBusy(false);
    }
  };

  const logout = () => {
    clearToken();
    resetSocket();
    setUsername('');
    setPassword('');
    setRooms([]);
    setRoomsLoading(false);
    setRoomsError('');
    setJoinName('');
    setJoinPassword('');
    setJoinError('');
    setCreateName('');
    setCreatePassword('');
    setCreateError('');
    setStage('auth');
  };

  const enterRoom = (name) => {
    const clean = (name || '').trim().replace(/^#/, '');
    if (!clean) return;
    setRoom(clean);
    setStage('chat');
  };

  // Join: the password is checked once, here. Afterwards the room sits in
  // "Your rooms" and opens without it.
  const submitJoinRoom = async (e) => {
    e.preventDefault();
    if (joinBusy) return;
    setJoinError('');
    setJoinBusy(true);
    try {
      const data = await joinRoom(joinName, joinPassword, getToken());
      setRooms(data.rooms || []);
      setRoomsError('');
      setJoinName('');
      setJoinPassword('');
      enterRoom(data.room);
    } catch (err) {
      setJoinError(err.message);
    } finally {
      setJoinBusy(false);
    }
  };

  // Create: sets the password others need once to join.
  const submitCreateRoom = async (e) => {
    e.preventDefault();
    if (createBusy) return;
    setCreateError('');
    setCreateBusy(true);
    try {
      const data = await createRoom(createName, createPassword, getToken());
      setRooms(data.rooms || []);
      setRoomsError('');
      setCreateName('');
      setCreatePassword('');
      enterRoom(data.room);
    } catch (err) {
      setCreateError(err.message);
    } finally {
      setCreateBusy(false);
    }
  };

  // The room in focus right now (matches the open chat, if any).
  const currentRoomName = room.trim() || 'general';
  const currentRoomInfo = rooms.find((r) => r.name === currentRoomName);
  // Admins can't leave their own room, and #general is everyone's home.
  const canLeaveCurrent = !!currentRoomInfo && !currentRoomInfo.admin && currentRoomName !== 'general';

  // Actually leave a room: membership is dropped server-side, so its password
  // is needed again to rejoin. Only reachable for rooms you're a plain member of.
  const doLeaveRoom = async (name) => {
    const data = await leaveRoom(name, getToken());
    setRooms(data.rooms || []);
    setPendingLeave('');
    if (stage === 'chat' && (room.trim() || 'general') === name) setStage('lobby');
  };

  // Commands shown in the palette (Ctrl/Cmd+K).
  const paletteActions = useMemo(() => {
    const list = [];
    if (stage === 'chat') {
      list.push({
        id: 'catchup',
        section: 'Actions',
        label: 'Catch me up',
        keywords: 'recap summary activity missed unread',
        icon: <SyncIcon size={14} />,
        run: () => setCatchUpRequest((n) => n + 1)
      });
      list.push({
        id: 'leave',
        section: 'Actions',
        label: 'Back to rooms',
        keywords: 'exit back lobby hub your rooms',
        icon: <ArrowLeftIcon size={14} />,
        run: () => setStage('lobby')
      });
      if (canLeaveCurrent) {
        list.push({
          id: 'leave-room',
          section: 'Actions',
          label: `Leave #${currentRoomName}…`,
          keywords: 'leave quit drop remove membership password',
          icon: <XCircleIcon size={14} />,
          run: () => setPendingLeave(currentRoomName)
        });
      }
    }
    const currentRoom = room.trim() || 'general';
    for (const r of rooms) {
      if (stage === 'chat' && r.name === currentRoom) continue;
      list.push({
        id: 'room-' + r.name,
        section: 'Rooms',
        label: `Go to #${r.name}`,
        keywords: 'switch room membership mine',
        icon: <HashIcon size={14} />,
        run: () => enterRoom(r.name)
      });
    }
    list.push({
      id: 'logout',
      section: 'Actions',
      label: 'Logout',
      keywords: 'sign out exit',
      icon: <SignOutIcon size={14} />,
      run: logout
    });
    return list;
    // paletteOpen keeps the room list fresh every time it opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, paletteOpen, room, rooms]);

  // Typing a room you're not in offers to create it — joining needs its
  // password, so that lives in the lobby's join section.
  const paletteQueryActions = (q) => {
    const name = q.replace(/^#/, '').trim();
    if (!name || rooms.some((r) => r.name === name)) return [];
    return [{
      id: 'create-' + name,
      section: 'Rooms',
      label: `Create room #${name}…`,
      icon: <PlusIcon size={14} />,
      run: () => {
        setCreateName(name);
        setCreateError('');
        setStage('lobby');
      }
    }];
  };

  // Rooms you created (you're their admin) vs rooms you've joined.
  const adminRooms = rooms.filter((r) => r.admin);
  const memberRooms = rooms.filter((r) => !r.admin);

  const roomItem = (r) => {
    const leavable = !r.admin && r.name !== 'general';
    return (
      <div className="room-picker-row" key={r.name}>
        <button
          type="button"
          className="room-picker-item"
          onClick={() => enterRoom(r.name)}
        >
          <span className="tree-icon" aria-hidden="true">#</span>
          <span className="tree-name">{r.name}</span>
          {r.admin && <span className="badge accent">admin</span>}
          {r.locked && <LockIcon size={12} />}
          <ArrowRightIcon size={14} className="room-picker-go" />
        </button>
        {leavable && (
          <button
            type="button"
            className="room-picker-leave"
            title={`Leave #${r.name}`}
            aria-label={`Leave #${r.name}`}
            onClick={() => setPendingLeave(r.name)}
          >
            <XIcon size={12} />
          </button>
        )}
      </div>
    );
  };

  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence mode="wait">
        {stage === 'checking' && (
          <motion.div
            key="checking"
            className="container"
            variants={pageVariants}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            <div className="loading" role="status">
              <span className="spinner" aria-hidden="true" />
              <span className="muted">Loading...</span>
            </div>
          </motion.div>
        )}

        {stage === 'auth' && (
          <motion.div
            key="auth"
            className="container"
            variants={pageVariants}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            <form className="card auth-card" onSubmit={submitAuth}>
              <div className="brand">
                <motion.span className="brand-badge" {...popIn}>
                  <GitChatLogo size={24} />
                </motion.span>
                <h1>GitChat</h1>
                <p className="sub">Sign in to join the conversation</p>
              </div>

              <div className="segmented">
                <button
                  type="button"
                  className={mode === 'login' ? 'active' : ''}
                  onClick={() => { setMode('login'); setError(''); }}
                >
                  {mode === 'login' && (
                    <motion.span layoutId="segment-thumb" className="segment-thumb" transition={springThumb} />
                  )}
                  <span className="segment-label">Login</span>
                </button>
                <button
                  type="button"
                  className={mode === 'register' ? 'active' : ''}
                  onClick={() => { setMode('register'); setError(''); }}
                >
                  {mode === 'register' && (
                    <motion.span layoutId="segment-thumb" className="segment-thumb" transition={springThumb} />
                  )}
                  <span className="segment-label">Register</span>
                </button>
              </div>

              <label className="field">
                <span className="field-label">Username</span>
                <input
                  placeholder="3-20 characters"
                  type="text"
                  required
                  minLength={3}
                  maxLength={20}
                  autoCapitalize="none"
                  spellCheck="false"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                />
              </label>

              <label className="field">
                <span className="field-label">Password</span>
                <input
                  placeholder="Minimum 6 characters"
                  type="password"
                  required
                  minLength={6}
                  maxLength={72}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                />
              </label>

              <AnimatePresence>
                {error && (
                  <motion.p role="alert" className="error-note" variants={errorVariants} initial="initial" animate="animate" exit="exit">
                    {error}
                  </motion.p>
                )}
              </AnimatePresence>

              <motion.button whileTap={{ scale: 0.98 }} type="submit" disabled={authBusy}>
                {authBusy ? 'Working…' : mode === 'login' ? 'Sign in' : 'Create account'}
              </motion.button>
            </form>
          </motion.div>
        )}

        {stage === 'lobby' && (
          <motion.div
            key="lobby"
            className="app-frame"
            variants={pageVariants}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            <AppHeader
              stage="lobby"
              username={username}
              room={room}
              onSearch={() => setPaletteOpen(true)}
              onLogout={logout}
            />
            <div className="lobby">
              <div className="card lobby-card">
                <div className="brand">
                  <motion.span style={{ display: 'inline-flex' }} {...popIn}>
                    <Avatar name={username} size={40} own />
                  </motion.span>
                  <h1>Hi, {username}</h1>
                  <p className="sub">Only rooms you're a member of show up here</p>
                </div>

                <div className="room-picker">
                  {adminRooms.length > 0 && (
                    <>
                      <h2 className="sidebar-label">Created by you</h2>
                      <div className="room-picker-list">{adminRooms.map(roomItem)}</div>
                      <p className="muted room-empty">
                        You're the admin here — open a room to manage its members.
                      </p>
                    </>
                  )}
                  <h2 className="sidebar-label">Your rooms</h2>
                  {roomsError && (
                    <p className="error-note" role="alert">
                      {roomsError}{' '}
                      <button type="button" className="inline-retry" onClick={refreshRooms}>Try again</button>
                    </p>
                  )}
                  <div className="room-picker-list">
                    {memberRooms.map(roomItem)}
                    {roomsLoading && rooms.length === 0 && (
                      <p className="muted room-empty" role="status">Loading your rooms…</p>
                    )}
                    {!roomsLoading && !roomsError && rooms.length === 0 && (
                      <p className="muted room-empty">No rooms yet — create one below.</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="lobby-columns">
                <form className="card lobby-card" onSubmit={submitJoinRoom}>
                  <h2 className="lobby-title">Join a room</h2>
                  <p className="sub">
                    Got a room name and its password? The password is only needed this once.
                  </p>
                  <label className="field">
                    <span className="field-label">Room name to join</span>
                    <input
                      placeholder="e.g. design-review"
                      required
                      maxLength={30}
                      value={joinName}
                      onChange={(e) => setJoinName(e.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">Room password to join</span>
                    <input
                      placeholder="Room password"
                      type="password"
                      required
                      maxLength={72}
                      value={joinPassword}
                      onChange={(e) => setJoinPassword(e.target.value)}
                      autoComplete="off"
                    />
                  </label>
                  <AnimatePresence>
                    {joinError && (
                        <motion.p role="alert" className="error-note" variants={errorVariants} initial="initial" animate="animate" exit="exit">
                        {joinError}
                      </motion.p>
                    )}
                  </AnimatePresence>
                  <motion.button whileTap={{ scale: 0.98 }} type="submit" disabled={joinBusy}>
                    {joinBusy ? 'Joining…' : 'Join room'}
                    <ArrowRightIcon size={16} />
                  </motion.button>
                </form>

                <form className="card lobby-card" onSubmit={submitCreateRoom}>
                  <h2 className="lobby-title">Create a room</h2>
                  <p className="sub">
                    Start a new room and set the password others need to join it.
                  </p>
                  <label className="field">
                    <span className="field-label">New room name</span>
                    <input
                      placeholder="e.g. weekend-hacks"
                      required
                      maxLength={30}
                      value={createName}
                      onChange={(e) => setCreateName(e.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">New room password</span>
                    <input
                      placeholder="At least 4 characters"
                      type="password"
                      required
                      minLength={4}
                      maxLength={72}
                      value={createPassword}
                      onChange={(e) => setCreatePassword(e.target.value)}
                      autoComplete="off"
                    />
                  </label>
                  <AnimatePresence>
                    {createError && (
                        <motion.p role="alert" className="error-note" variants={errorVariants} initial="initial" animate="animate" exit="exit">
                        {createError}
                      </motion.p>
                    )}
                  </AnimatePresence>
                  <motion.button whileTap={{ scale: 0.98 }} type="submit" disabled={createBusy}>
                    {createBusy ? 'Creating…' : 'Create room'}
                    <PlusIcon size={16} />
                  </motion.button>
                </form>
              </div>
            </div>
          </motion.div>
        )}

        {stage === 'chat' && (
          <motion.div
            key="chat"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
          >
            <div className="app-frame">
              <AppHeader
                stage="chat"
                username={username}
                room={(room.trim() || 'general')}
                sidebarCollapsed={sidebarCollapsed}
                onToggleSidebar={toggleSidebar}
                onSearch={() => setPaletteOpen(true)}
                onLeave={() => setStage('lobby')}
                onAskLeave={() => setPendingLeave(currentRoomName)}
                canLeave={canLeaveCurrent}
                onLogout={logout}
              />
              <Chat
                username={username}
                room={(room.trim() || 'general')}
                rooms={rooms}
                catchUpRequest={catchUpRequest}
                sidebarCollapsed={sidebarCollapsed}
                onSelectRoom={enterRoom}
                onOpenRoomHub={() => setStage('lobby')}
                onRefreshRooms={refreshRooms}
                onLogout={logout}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {paletteOpen && (stage === 'lobby' || stage === 'chat') && (
          <CommandPalette
            actions={paletteActions}
            queryActions={paletteQueryActions}
            onClose={() => setPaletteOpen(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {pendingLeave && (
          <LeaveRoomDialog
            room={pendingLeave}
            onCancel={() => setPendingLeave('')}
            onConfirm={() => doLeaveRoom(pendingLeave)}
          />
        )}
      </AnimatePresence>
    </MotionConfig>
  );
}
