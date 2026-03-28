'use strict';
const mongoose = require('mongoose');

const OPTS = {
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
};

async function connectDB() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGO_URI environment variable is not set');

  try {
    await mongoose.connect(uri, OPTS);
    console.log(`✅  MongoDB connected: ${mongoose.connection.host}`);

    mongoose.connection.on('error', err => console.error('MongoDB error:', err));
    mongoose.connection.on('disconnected', () => {
      console.warn('MongoDB disconnected — reconnecting…');
      setTimeout(() => mongoose.connect(uri, OPTS).catch(console.error), 5000);
    });
  } catch (err) {
    console.error('MongoDB connection failed:', err.message);
    throw err;
  }
}

module.exports = connectDB;
