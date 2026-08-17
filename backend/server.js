'use strict';
require('dotenv').config();

/* Validate the environment BEFORE anything else loads. With no JWT_SECRET the
   process used to start, report /api/health as healthy, and 500 on every
   login — green monitoring on an unusable app. (N-4) */
require('./src/config/env').assertEnv();

const app = require('./src/app');
const connectDB = require('./src/config/db');

const PORT = process.env.PORT || 5000;

async function start() {
  await connectDB();

  // Auto-create superadmin if the database is empty (first-run / production bootstrap)
  const initAdmin = require('./src/utils/initAdmin');
  await initAdmin();

  // Configurable pipeline rules (R-2). Seed any missing rows, then resolve the
  // active set. In production an invalid stored value aborts the boot rather
  // than silently reverting to a default the Settings page does not show.
  const { seedRuleSettings, loadRules } = require('./src/config/pipelineRuntime');
  await seedRuleSettings();
  await loadRules();

  // Start email report scheduler + nightly sweeps (both skip in test env)
  if (process.env.NODE_ENV !== 'test') {
    const { initScheduler, initSweeps } = require('./src/utils/scheduler');
    await initScheduler();
    initSweeps();
  }

  const server = app.listen(PORT, () => {
    console.log(`\n🚀  IINVSYS API running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
    console.log(`📋  Health: http://localhost:${PORT}/api/health\n`);
  });

  // Graceful shutdown
  /* Mongoose 8 removed the callback signature of connection.close(); passing
     one meant the callback never fired and the process only ever exited via
     the 10s timeout below. It returns a promise now. */
  const shutdown = (signal) => {
    console.log(`\n${signal} received — shutting down gracefully`);
    const force = setTimeout(() => process.exit(1), 10000);
    server.close(async () => {
      try {
        await require('mongoose').connection.close(false);
        console.log('MongoDB connection closed');
        clearTimeout(force);
        process.exit(0);
      } catch (err) {
        console.error('Error closing MongoDB connection:', err.message);
        process.exit(1);
      }
    });
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
