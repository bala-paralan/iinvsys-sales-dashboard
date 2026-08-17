'use strict';
const mongoose = require('mongoose');

const OPTS = {
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
};

/* Listeners are registered once. connectDB() is called per process, but a
   reconnect used to add another pair every time. */
let _listenersBound = false;

async function connectDB() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGO_URI environment variable is not set');

  try {
    await mongoose.connect(uri, OPTS);
    console.log(`✅  MongoDB connected: ${mongoose.connection.host}`);

    if (!_listenersBound) {
      _listenersBound = true;
      mongoose.connection.on('error', (err) => console.error('MongoDB error:', err));

      /*
       * NO MANUAL RECONNECT HERE — deliberately.
       *
       * This used to schedule `setTimeout(() => mongoose.connect(...), 5000)`
       * on every 'disconnected' event, which broke every short-lived script:
       * `npm run seed` and `npm run seed:prod` print "Seed complete!", call
       * mongoose.disconnect(), and then the handler re-opens the connection and
       * keeps the event loop alive forever. The process never exits, so an
       * operator seeding production sees a hung terminal and Ctrl-Cs it —
       * mid-write, if the timing is unlucky.
       *
       * It was also redundant. The MongoDB driver monitors the topology and
       * reconnects on its own; re-entering mongoose.connect() on top of that is
       * a well-known anti-pattern. Log the event and let the driver recover.
       */
      mongoose.connection.on('disconnected', () => {
        console.warn('MongoDB disconnected — the driver will reconnect if the server returns.');
      });
    }
  } catch (err) {
    console.error('MongoDB connection failed:', err.message);
    throw err;
  }
}

module.exports = connectDB;
