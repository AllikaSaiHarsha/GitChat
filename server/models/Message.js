import mongoose from 'mongoose';

// Persisted message history. Read via loadHistory() in socket.js,
// written on every send_message. Memory store remains as fallback.
const messageSchema = new mongoose.Schema({
  // App-generated id: keeps ids stable between live broadcasts and Mongo
  // history (reactions/jumps key off it). Falls back to _id for old docs.
  mid: { type: String, index: true },
  room: { type: String, required: true },
  username: { type: String, required: true },
  text: { type: String, required: true, maxlength: 1000 },
  createdAt: { type: Date, default: Date.now }
});

// History and activity both filter by room and sort/range by createdAt:
// one compound index serves both (replaces the old room-only index).
messageSchema.index({ room: 1, createdAt: 1 });

export const Message = mongoose.model('Message', messageSchema);
