import mongoose from 'mongoose';

// Persisted message history. Read via loadHistory() in socket.js,
// written on every send_message. Memory store remains as fallback.
const messageSchema = new mongoose.Schema({
  // App-generated id: keeps ids stable between live broadcasts and Mongo
  // history (reactions/jumps key off it). Falls back to _id for old docs.
  mid: { type: String, index: true },
  room: { type: String, required: true, index: true },
  username: { type: String, required: true },
  text: { type: String, required: true, maxlength: 1000 },
  createdAt: { type: Date, default: Date.now }
});

export const Message = mongoose.model('Message', messageSchema);
