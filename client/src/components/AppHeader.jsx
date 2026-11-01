import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeftIcon,
  ChevronDownIcon,
  SearchIcon,
  SidebarCollapseIcon,
  SidebarExpandIcon,
  SignOutIcon,
  XCircleIcon
} from '@primer/octicons-react';
import GitChatLogo from './GitChatLogo.jsx';
import Avatar from './Avatar.jsx';

// Compact GitHub-style top navigation: brand, search (opens the command
// palette), sidebar toggle (chat only) and the user menu.
export default function AppHeader({
  stage,
  username,
  room,
  sidebarCollapsed,
  onToggleSidebar,
  onSearch,
  onLeave,
  onAskLeave,
  canLeave,
  onLogout
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const userRef = useRef(null);
  const userButtonRef = useRef(null);
  const isMac =
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');

  // Close the user menu on outside click / Escape.
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onPointerDown = (e) => {
      if (!userRef.current?.contains(e.target)) setMenuOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        userButtonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const run = (fn) => {
    setMenuOpen(false);
    userButtonRef.current?.focus();
    fn?.();
  };

  return (
    <header className="app-header glass-header">
      <div className="app-header-inner">
        {stage === 'chat' && (
          <button
            type="button"
            className="header-icon-btn"
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={onToggleSidebar}
          >
            {sidebarCollapsed ? <SidebarExpandIcon size={16} /> : <SidebarCollapseIcon size={16} />}
          </button>
        )}

        <span className="header-brand">
          <span className="brand-badge small">
            <GitChatLogo size={17} />
          </span>
          <span className="header-brand-text">GitChat</span>
        </span>

        <button
          type="button"
          className="header-search"
          onClick={onSearch}
          aria-label="Search or jump to"
        >
          <SearchIcon size={14} />
          <span className="header-search-text">Search or jump to…</span>
          <span className="palette-kbd">{isMac ? '⌘K' : 'Ctrl K'}</span>
        </button>

        <div className="header-user" ref={userRef}>
          <button
            ref={userButtonRef}
            type="button"
            className="header-user-btn"
            aria-expanded={menuOpen}
            aria-controls={menuOpen ? 'user-actions' : undefined}
            onClick={() => setMenuOpen((o) => !o)}
          >
            <Avatar name={username} size={22} own />
            <span className="header-username">{username}</span>
            <ChevronDownIcon size={12} />
          </button>

          <AnimatePresence>
            {menuOpen && (
              <motion.div
                id="user-actions"
                className="user-menu"
                initial={{ opacity: 0, y: -4, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.98 }}
                transition={{ duration: 0.12, ease: 'easeOut' }}
              >
                <div className="user-menu-head">
                  <Avatar name={username} size={28} own />
                  <span className="user-menu-id">
                    <span className="user-menu-name">{username}</span>
                    <span className="user-menu-sub">
                      {stage === 'chat' ? `#${room}` : 'In the lobby'}
                    </span>
                  </span>
                </div>
                <div className="user-menu-sep" />
                {stage === 'chat' && (
                  <button
                    type="button"
                    className="user-menu-item"
                    onClick={() => run(onLeave)}
                  >
                    <ArrowLeftIcon size={14} />
                    Back to rooms
                  </button>
                )}
                {stage === 'chat' && canLeave && (
                  <button
                    type="button"
                    className="user-menu-item"
                    title={`Stop being a member of #${room}`}
                    onClick={() => run(onAskLeave)}
                  >
                    <XCircleIcon size={14} />
                    Leave #{room}…
                  </button>
                )}
                <button
                  type="button"
                  className="user-menu-item"
                  onClick={() => run(onLogout)}
                >
                  <SignOutIcon size={14} />
                  Logout
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </header>
  );
}
