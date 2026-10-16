import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckIcon, CopyIcon, PersonAddIcon, SignOutIcon, SmileyIcon } from '@primer/octicons-react';
import Avatar from './Avatar.jsx';
import MarkdownBody from './MarkdownBody.jsx';
import { copyText } from '../lib/clipboard.js';

// Comment rows rise in with a light spring, like GitHub timeline items.
const rowVariants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 420, damping: 32 } }
};

// GitHub's reaction set.
const REACTIONS = ['👍', '👎', '😄', '🎉', '😕', '❤️', '🚀', '👀'];

function formatTime(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Comment-thread style row: header (avatar, username, time) + markdown body +
// reactions, with hover actions (copy, react). "system" messages render as a
// centered timeline event instead.
export default function MessageRow({ message, own, me, reactions = [], onReact, highlighted }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const actionsRef = useRef(null);

  // Close the reaction picker on outside click / Escape.
  useEffect(() => {
    if (!pickerOpen) return undefined;
    const onPointerDown = (e) => {
      if (!actionsRef.current?.contains(e.target)) setPickerOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setPickerOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [pickerOpen]);

  if (message.username === 'system') {
    const left = /\bleft\b/i.test(message.text);
    return (
      <motion.div className="event-row" variants={rowVariants}>
        <span className="event-icon" aria-hidden="true">
          {left ? <SignOutIcon size={12} /> : <PersonAddIcon size={12} />}
        </span>
        <span className="event-text">{message.text}</span>
        <span className="event-time">{formatTime(message.createdAt)}</span>
      </motion.div>
    );
  }

  const pick = (emoji) => {
    setPickerOpen(false);
    onReact?.(message.id, emoji);
  };

  const copyMessage = async () => {
    if (await copyText(message.text)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const className = [
    'comment',
    own ? 'comment-own' : '',
    pickerOpen ? 'comment-picking' : '',
    highlighted ? 'comment-highlight' : ''
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <motion.article id={'msg-' + message.id} className={className} variants={rowVariants}>
      <header className="comment-header">
        <Avatar name={message.username} size={24} own={own} />
        <span className="comment-author">{message.username}</span>
        {own && <span className="badge">you</span>}
        <span className="comment-time">{formatTime(message.createdAt)}</span>
        <div className="comment-actions" ref={actionsRef}>
          <motion.button
            whileTap={{ scale: 0.9 }}
            type="button"
            className="msg-action"
            aria-label={copied ? 'Copied' : 'Copy message'}
            title={copied ? 'Copied!' : 'Copy message'}
            onClick={copyMessage}
          >
            {copied ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.9 }}
            type="button"
            className="msg-action"
            aria-label="Add reaction"
            title="Add reaction"
            onClick={() => setPickerOpen((o) => !o)}
          >
            <SmileyIcon size={16} />
          </motion.button>
          <AnimatePresence>
            {pickerOpen && (
              <motion.div
                className="react-picker"
                initial={{ opacity: 0, y: -4, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.95 }}
                transition={{ duration: 0.12, ease: 'easeOut' }}
              >
                {REACTIONS.map((e) => {
                  const mine = reactions.some((r) => r.emoji === e && r.users?.includes(me));
                  return (
                    <button
                      key={e}
                      type="button"
                      className={mine ? 'react-option active' : 'react-option'}
                      title={`React ${e}`}
                      onClick={() => pick(e)}
                    >
                      {e}
                    </button>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </header>

      <div className="comment-body">
        <MarkdownBody text={message.text} />
      </div>

      <AnimatePresence initial={false}>
        {reactions.length > 0 && (
          <motion.div
            className="reactions"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
          >
            <AnimatePresence initial={false}>
              {reactions.map((r) => {
                const mine = r.users?.includes(me);
                return (
                  <motion.button
                    key={r.emoji}
                    layout
                    type="button"
                    className={mine ? 'reaction-pill mine' : 'reaction-pill'}
                    title={(r.users || []).join(', ')}
                    onClick={() => onReact?.(message.id, r.emoji)}
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.5, opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 520, damping: 30 }}
                  >
                    <span className="reaction-emoji">{r.emoji}</span>
                    <motion.span
                      key={r.users.length}
                      className="reaction-count"
                      initial={{ scale: 0.6 }}
                      animate={{ scale: 1 }}
                      transition={{ type: 'spring', stiffness: 600, damping: 28 }}
                    >
                      {r.users.length}
                    </motion.span>
                  </motion.button>
                );
              })}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.article>
  );
}
