import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { XCircleIcon } from '@primer/octicons-react';

// Confirmation dialog for leaving a room on your own. Leaving drops your
// membership, so the room password is needed again to rejoin.
export default function LeaveRoomDialog({ room, onCancel, onConfirm }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Escape closes the dialog (unless a leave request is in flight).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel, busy]);

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await onConfirm(); // the parent closes the dialog on success
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <motion.div
      className="dialog-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.14, ease: 'easeOut' }}
      onClick={busy ? undefined : onCancel}
    >
      <motion.div
        className="dialog-card"
        role="dialog"
        aria-modal="true"
        aria-label={`Leave #${room}`}
        initial={{ opacity: 0, y: 10, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 6, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 420, damping: 34 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="dialog-title">
          <XCircleIcon size={16} />
          Leave #{room}?
        </h3>
        <p className="dialog-text">
          It disappears from your rooms and you'll need its password again to rejoin. Messages stay for
          everyone else.
        </p>
        {error && <p className="error-note">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="danger" onClick={confirm} disabled={busy}>
            {busy ? 'Leaving…' : 'Leave room'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
