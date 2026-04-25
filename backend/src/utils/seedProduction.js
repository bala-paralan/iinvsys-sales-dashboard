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
 *   ADMIN_PASSWORD  default: Admin@123   ← change immediately after login!
 */
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

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

  const email       = (process.env.ADMIN_EMAIL    || 'admin@iinvsys.com').toLowerCase();
  const rawPassword =  process.env.ADMIN_PASSWORD || 'Admin@123';
  const hashed      = await bcrypt.hash(rawPassword, 12);

  await User.create({
    name:     'Admin IINVSYS',
    email,
    password: hashed,
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
