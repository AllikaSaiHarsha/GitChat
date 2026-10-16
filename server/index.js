import dotenv from 'dotenv';
import { createApp } from './app.js';
import { connectDb } from './db.js';

dotenv.config();

const PORT = process.env.PORT || 5000;

const { server } = createApp();

await connectDb(process.env.MONGO_URI);

server.listen(PORT, () => {
  console.log(`server running on http://localhost:${PORT}`);
});
