'use strict';
require('dotenv').config();
const app = require('./src/app');
const connectDB = require('./src/config/db');

const PORT = process.env.PORT || 5000;

async function start() {
  await connectDB();

  // Auto-create superadmin if the database is empty (first-run / production bootstrap)
  const initAdmin = require('./src/utils/initAdmin');
  await initAdmin();

  // Start email report scheduler (skip in test env)
  if (process.env.NODE_ENV !== 'test') {
    const { initScheduler } = require('./src/utils/scheduler');
    await initScheduler();
  }

  const server = app.listen(PORT, () => {
    console.log(`\n🚀  IINVSYS API running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
    console.log(`📋  Health: http://localhost:${PORT}/api/health\n`);
  });

  // Graceful shutdown
  const shutdown = (signal) => {
    console.log(`\n${signal} received — shutting down gracefully`);
    server.close(() => {
      require('mongoose').connection.close(false, () => {
        console.log('MongoDB connection closed');
        process.exit(0);
      });
    });
    setTimeout(() => process.exit(1), 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('unhandledRejection', (err) => {
    console.error('Unhandled Rejection:', err.message);
    server.close(() => process.exit(1));
  });
}

start().catch(err => {
  console.error('Failed to start server:', err.message);
  process.exit(1);
});
