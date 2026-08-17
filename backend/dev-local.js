'use strict';
/**
 * Local dev runner — `node dev-local.js` (or the `iinvsys-api` launch entry).
 *
 * This machine has no Docker and no mongod, and `.env` here is
 * PRODUCTION-shaped (NODE_ENV=production, PORT=8413, CORS locked to
 * sales.iinvsys.com). Booting straight from it runs a production config on a
 * laptop and rejects every localhost request at CORS.
 *
 * So: spin an ephemeral in-memory MongoDB, force safe local env, seed the demo
 * fixtures, then start the API on :5001 — the port the legacy app.js hardcodes
 * for localhost and the React dev server proxies to. dotenv never overwrites
 * variables that are already set, so assigning them before requiring server.js
 * wins over .env.
 */
const path = require('path');
const { spawn } = require('child_process');
const { MongoMemoryServer } = require('mongodb-memory-server');

(async () => {
  console.log('▶  starting in-memory MongoDB …');
  const mem = await MongoMemoryServer.create({ instance: { dbName: 'iinvsys' } });
  const uri = mem.getUri('iinvsys');
  console.log(`   ${uri}`);

  const env = {
    MONGO_URI: uri,
    NODE_ENV: 'development',
    PORT: '5001',
    /* An explicit dev secret rather than whatever .env carries — env vars set
       here win over dotenv, so a token minted locally can never be valid
       against production, and the runner works even when cwd is not backend/
       (launch.json starts it from the project root, where dotenv finds no
       .env at all — that was a real bug: JWT_SECRET undefined, every login
       a 500). */
    JWT_SECRET: 'dev-local-secret-not-for-production',
    /* Legacy app on :3000/:3456, React dev server on :5173 (which proxies /api
       same-origin, but keep it listed for direct calls). */
    CORS_ORIGINS: [3000, 3001, 3456, 5173, 8080]
      .map((p) => `http://localhost:${p}`).join(','),
    ADMIN_EMAIL: 'admin@iinvsys.com',
    ADMIN_PASSWORD: 'Admin@123', // dev fixture only — matches seed.js
    // Where invite links point. Taken from config, never from the Host header
    // — otherwise a spoofed Host mints links to an attacker's domain.
    PUBLIC_APP_URL: 'http://localhost:5173',
  };
  Object.assign(process.env, env);

  console.log('▶  seeding demo data …');
  /* Async spawn, NOT spawnSync: spawnSync blocks this process's event loop,
     and the in-memory mongod above needs that loop to pump its stdio — the
     two deadlock and the API never starts. */
  await new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['src/utils/seed.js'], {
      cwd: __dirname,
      env: { ...process.env, ...env },
      stdio: 'inherit',
    });
    p.on('error', reject);
    p.on('exit', (code) => (code === 0
      ? resolve()
      : reject(new Error(`seed failed (exit ${code})`))));
  });

  console.log('▶  starting API on :5001 …');
  require(path.join(__dirname, 'server.js'));

  const shutdown = async () => { await mem.stop(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
})().catch((err) => {
  console.error('dev-local failed:', err);
  process.exit(1);
});
