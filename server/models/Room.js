import mongoose from 'mongoose';

// One chat room. `name` is unique and normalized (lowercase, dashes only).
// `members` is who is allowed inside: rooms are private to their members.
// `passwordHash` gates the FIRST join only — once you're in `members` the
// password is never asked again. Legacy rooms (created before this model
// existed) get a doc without a password on first join.
const roomSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, index: true },
  passwordHash: { type: String, default: null },
  createdBy: { type: String, default: '' },
  members: { type: [String], default: [] },
  createdAt: { type: Date, default: Date.now }
});

export const Room = mongoose.model('Room', roomSchema);
