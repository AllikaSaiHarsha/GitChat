import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { SearchIcon } from '@primer/octicons-react';
import useModalFocus from '../hooks/useModalFocus.js';

// App command palette. Opened with Ctrl/Cmd+K from App.
// `actions`: static items. `queryActions(q)`: extra items derived from the query
// (used for "Join room #<querystring>").
export default function CommandPalette({ actions = [], queryActions, onClose }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const dialogRef = useRef(null);

  useModalFocus(dialogRef, inputRef);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const statics = q
      ? actions.filter((a) => `${a.label} ${a.keywords || ''}`.toLowerCase().includes(q))
      : actions;
    const extra = q && queryActions ? queryActions(query.trim()) : [];
    return [...extra, ...statics];
  }, [actions, query, queryActions]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  const safeActive = items.length ? Math.min(active, items.length - 1) : 0;

  const run = (item) => {
    if (!item) return;
    onClose();
    // let the palette unmount before the action switches stages
    setTimeout(() => item.run?.(), 0);
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((safeActive + 1) % Math.max(items.length, 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((safeActive - 1 + Math.max(items.length, 1)) % Math.max(items.length, 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(items[safeActive]);
    }
  };

  // Group by section while keeping one flat keyboard index.
  const groups = [];
  let flat = -1;
  for (const item of items) {
    const section = item.section || 'Actions';
    let g = groups.find((x) => x.section === section);
    if (!g) {
      g = { section, items: [] };
      groups.push(g);
    }
    g.items.push(item);
  }

  return (
    <motion.div
      className="palette-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
      onClick={onClose}
    >
      <motion.div
        ref={dialogRef}
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        tabIndex={-1}
        initial={{ opacity: 0, y: -8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -6, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 420, damping: 34 }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="palette-input-row">
          <SearchIcon size={16} className="palette-search" />
          <input
            ref={inputRef}
            className="palette-input"
            placeholder="Search rooms and commands..."
            aria-label="Search commands"
            spellCheck="false"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <span className="palette-kbd">esc</span>
        </div>

        <div className="palette-list">
          {items.length === 0 && <div className="palette-empty">No matching commands</div>}
          {groups.map((g) => (
            <div key={g.section}>
              <div className="palette-section">{g.section}</div>
              {g.items.map((item) => {
                flat += 1;
                const idx = flat;
                const isActive = idx === safeActive;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={isActive ? 'palette-item active' : 'palette-item'}
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => run(item)}
                  >
                    {item.icon && <span className="palette-icon">{item.icon}</span>}
                    <span className="palette-label">{item.label}</span>
                    {isActive ? (
                      <span className="palette-hint">↵</span>
                    ) : item.hint ? (
                      <span className="palette-hint">{item.hint}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="palette-footer">
          <span>
            <span className="palette-kbd">↑↓</span> navigate
          </span>
          <span>
            <span className="palette-kbd">↵</span> select
          </span>
          <span>
            <span className="palette-kbd">esc</span> close
          </span>
        </div>
      </motion.div>
    </motion.div>
  );
}
