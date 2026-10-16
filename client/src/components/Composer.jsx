import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { PaperAirplaneIcon } from '@primer/octicons-react';

// GitHub comment-box style composer: auto-growing textarea plus a footer bar.
// Enter sends (handled by the parent), Shift+Enter inserts a newline.
export default function Composer({ value, offline, onChange, onKeyDown, onSend }) {
  const ref = useRef(null);

  // Grow with content up to ~6 lines, then scroll.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 140) + 'px';
  }, [value]);

  return (
    <div className="composer">
      <textarea
        ref={ref}
        id="composer-input"
        className="composer-input"
        rows={1}
        placeholder="Type a message…"
        aria-label="Message"
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
      />
      <div className="composer-footer">
        <span className="composer-hint">
          {offline ? 'Reconnecting — try again in a moment' : 'Enter to send · Shift + Enter for a new line'}
        </span>
        <motion.button
          type="button"
          whileTap={{ scale: 0.95 }}
          onClick={onSend}
          disabled={!value.trim() || offline}
        >
          <PaperAirplaneIcon size={16} />
          Send
        </motion.button>
      </div>
    </div>
  );
}
