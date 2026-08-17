'use strict';
/**
 * seedProduction — wipes ALL data and creates only the superadmin account.
 * Use this to reset the database to a clean production state.
 *
 * Usage:
 *   cd backend
 *   node src/utils/seedProduction.js
 *
 * Environment variables (optional overrides):
 *   ADMIN_EMAIL     default: admin@iinvsys.com
 *   ADMIN_PASSWORD  required in production; otherwise a random one is generated
 *                   and printed once.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { generatePassword } = require('./initAdmin');

const User    = require('../models/User');
const Agent   = require('../models/Agent');
const Product = require('../models/Product');
const Expo    = require('../models/Expo');
const Lead    = require('../models/Lead');
const connectDB = require('../config/db');

async function seedProduction() {
  await connectDB();
  console.log('\n🗑️   Wiping all collections …');

  await Promise.all([
    User.deleteMany({}),
    Agent.deleteMany({}),
    Product.deleteMany({}),
    Expo.deleteMany({}),
    Lead.deleteMany({}),
  ]);
  console.log('    All collections cleared.\n');

  const email = (process.env.ADMIN_EMAIL || 'admin@iinvsys.com').toLowerCase();

  let rawPassword = process.env.ADMIN_PASSWORD;
  if (!rawPassword) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'ADMIN_PASSWORD must be set when seeding a production database. ' +
        'Refusing to create an account with a default password.'
      );
    }
    rawPassword = generatePassword();
  }

  /* Pass plain-text — the User pre('save') hook hashes it. Pre-hashing here
     double-hashes, and the printed password then never authenticates. */
  await User.create({
    name:     'Admin IINVSYS',
    email,
    password: rawPassword,
    role:     'superadmin',
    isActive: true,
  });

  console.log('✅  Production seed complete!\n');
  console.log('   Superadmin credentials:');
  console.log(`   Email   : ${email}`);
  console.log(`   Password: ${rawPassword}`);
  console.log('\n   ⚠️  Change the password immediately after first login!\n');

  await mongoose.disconnect();
}

seedProduction().catch(err => {
  console.error('❌  Seed failed:', err.message);
  process.exit(1);
});
