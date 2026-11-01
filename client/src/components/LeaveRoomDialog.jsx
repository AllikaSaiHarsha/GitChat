import { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { XCircleIcon } from '@primer/octicons-react';
import useModalFocus from '../hooks/useModalFocus.js';

// Confirmation dialog for leaving a room on your own. Leaving drops your
// membership, so the room password is needed again to rejoin.
export default function LeaveRoomDialog({ room, onCancel, onConfirm }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useRef(null);
  const cancelRef = useRef(null);
  useModalFocus(dialogRef, cancelRef);

  const confirm = async () => {
    if (busy) return;
    dialogRef.current?.focus();
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
        ref={dialogRef}
        className="dialog-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="leave-room-title"
        tabIndex={-1}
        initial={{ opacity: 0, y: 10, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 6, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 420, damping: 34 }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !busy) {
            e.stopPropagation();
            onCancel();
          }
        }}
      >
        <h2 id="leave-room-title" className="dialog-title">
          <XCircleIcon size={16} />
          Leave #{room}?
        </h2>
        <p className="dialog-text">
          It disappears from your rooms and you'll need its password again to rejoin. Messages stay for
          everyone else.
        </p>
        {error && <p className="error-note">{error}</p>}
        <div className="dialog-actions">
          <button ref={cancelRef} type="button" className="ghost" onClick={onCancel} disabled={busy}>
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
