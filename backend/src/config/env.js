'use strict';
/**
 * env.js — validate the environment at BOOT, not at first request. (N-4)
 *
 * The failure this prevents: with no `JWT_SECRET`, the process started
 * happily, served `/api/health` as "healthy", and then returned 500 on every
 * single login. Health checks passed, monitoring was green, and the app was
 * completely unusable. A missing secret is a deployment error and should look
 * like one — at the moment of deployment.
 *
 * `RATE_LIMIT` vs `RATE_LIMIT_MAX`: `.env.example` documented one name and
 * `app.js` read the other, so raising the limit in production did nothing.
 * Both are accepted here and the mismatch is reported as a warning.
 */

/** Required in every environment. */
const REQUIRED = ['JWT_SECRET', 'MONGO_URI'];

/** Required additionally in production. */
const REQUIRED_IN_PRODUCTION = ['CORS_ORIGINS'];

/**
 * Secrets that must not be left at a well-known value. `Admin@123` is the
 * default in this repo's own docker-compose history and in initAdmin.
 */
const FORBIDDEN_VALUES = {
  JWT_SECRET: ['change-me', 'secret', 'changeme', 'your-secret-key', 'dev-secret'],
  ADMIN_PASSWORD: ['Admin@123', 'admin123', 'password'],
};

const MIN_SECRET_LENGTH = 32;

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

/**
 * @returns {{errors: string[], warnings: string[]}}
 */
function checkEnv(env = process.env) {
  const errors = [];
  const warnings = [];

  for (const key of REQUIRED) {
    if (!env[key] || !String(env[key]).trim()) errors.push(`${key} is not set`);
  }

  if (isProduction()) {
    for (const key of REQUIRED_IN_PRODUCTION) {
      if (!env[key] || !String(env[key]).trim()) {
        /* CORS_ORIGINS blank means app.js falls back to '*' WITH
           credentials:true — which is the docker-compose default and is a
           cross-origin credential leak, not a permissive convenience. */
        errors.push(`${key} is not set (blank in production means CORS '*' with credentials)`);
      }
    }

    if (env.JWT_SECRET && env.JWT_SECRET.length < MIN_SECRET_LENGTH) {
      errors.push(`JWT_SECRET is shorter than ${MIN_SECRET_LENGTH} characters`);
    }

    for (const [key, banned] of Object.entries(FORBIDDEN_VALUES)) {
      if (env[key] && banned.includes(env[key])) {
        errors.push(`${key} is set to a well-known default value`);
      }
    }

    if (env.FILE_STORE_DRIVER === 'local' && env.VERCEL) {
      errors.push('FILE_STORE_DRIVER=local cannot work on Vercel — its filesystem is ephemeral');
    }
  } else if (env.JWT_SECRET && env.JWT_SECRET.length < MIN_SECRET_LENGTH) {
    warnings.push(`JWT_SECRET is shorter than ${MIN_SECRET_LENGTH} characters (an error in production)`);
  }

  if (env.RATE_LIMIT && !env.RATE_LIMIT_MAX) {
    warnings.push('RATE_LIMIT is set but the code reads RATE_LIMIT_MAX — the value is being ignored');
  }

  return { errors, warnings };
}

/**
 * Validate and abort on failure. Called once, before anything binds a port.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.exit=true] throw instead of exiting — for tests
 */
function assertEnv(opts = {}) {
  const { errors, warnings } = checkEnv();

  for (const w of warnings) console.warn(`⚠️  env: ${w}`);

  if (!errors.length) return { errors, warnings };

  const message = `Refusing to start — environment is not usable:\n${
    errors.map((e) => `  · ${e}`).join('\n')}`;

  if (opts.exit === false) throw new Error(message);
  console.error(`\n❌  ${message}\n`);
  process.exit(1);
  return { errors, warnings };   // unreachable; keeps the signature honest
}

module.exports = {
  checkEnv, assertEnv,
  REQUIRED, REQUIRED_IN_PRODUCTION, FORBIDDEN_VALUES, MIN_SECRET_LENGTH,
};
