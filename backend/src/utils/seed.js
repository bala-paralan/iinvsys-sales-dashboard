'use strict';
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const User    = require('../models/User');
const Agent   = require('../models/Agent');
const Product = require('../models/Product');
const Expo    = require('../models/Expo');
const Lead    = require('../models/Lead');
const connectDB = require('../config/db');

/* ─── Seed data ─────────────────────────────────────────────────── */

const USERS_SEED = [
  { name: 'Admin IINVSYS',   email: 'admin@iinvsys.com',  password: 'Admin@123',  role: 'superadmin' },
  { name: 'Sneha Kapoor',    email: 'sneha@iinvsys.com',  password: 'Manager@123', role: 'manager' },
  { name: 'Rahul Sharma',    email: 'rahul@iinvsys.com',  password: 'Agent@123',  role: 'agent' },
  { name: 'Priya Singh',     email: 'priya@iinvsys.com',  password: 'Agent@123',  role: 'agent' },
  { name: 'Amit Verma',      email: 'amit@iinvsys.com',   password: 'Agent@123',  role: 'agent' },
  { name: 'Read Only User',  email: 'readonly@iinvsys.com', password: 'Read@1234', role: 'readonly' },
];

const AGENTS_SEED = [
  { name: 'Rahul Sharma', initials: 'RS', email: 'rahul@iinvsys.com', phone: '9876543210', territory: 'Delhi NCR',   designation: 'Senior Sales Agent', target: 5000000, color: '#e74c3c' },
  { name: 'Priya Singh',  initials: 'PS', email: 'priya@iinvsys.com', phone: '9876543211', territory: 'Mumbai',      designation: 'Sales Agent',         target: 4000000, color: '#8e44ad' },
  { name: 'Amit Verma',   initials: 'AV', email: 'amit@iinvsys.com',  phone: '9876543212', territory: 'Bangalore',   designation: 'Sales Agent',         target: 3500000, color: '#27ae60' },
  { name: 'Neha Gupta',   initials: 'NG', email: 'neha@iinvsys.com',  phone: '9876543213', territory: 'Hyderabad',   designation: 'Junior Sales Agent',  target: 2500000, color: '#f39c12' },
  { name: 'Karan Mehta',  initials: 'KM', email: 'karan@iinvsys.com', phone: '9876543214', territory: 'Chennai',     designation: 'Sales Agent',         target: 3000000, color: '#2980b9' },
  { name: 'Sonia Patel',  initials: 'SP', email: 'sonia@iinvsys.com', phone: '9876543215', territory: 'Pune',        designation: 'Senior Sales Agent',  target: 4500000, color: '#c0392b' },
];

const PRODUCTS_SEED = [
  { name: 'IINVSYS Lite',       sku: 'INV-LT-001', category: 'software', price: 29999,  description: 'Entry-level inventory management for SMBs', isActive: true },
  { name: 'IINVSYS Pro',        sku: 'INV-PR-002', category: 'software', price: 79999,  description: 'Full-featured inventory suite with analytics', isActive: true },
  { name: 'IINVSYS Enterprise', sku: 'INV-EN-003', category: 'bundle',   price: 199999, description: 'Multi-warehouse, API integrations, white-label', isActive: true },
  { name: 'Barcode Scanner Kit',sku: 'HW-BS-004',  category: 'hardware', price: 14999,  description: '2D barcode scanner with USB & BT connectivity', isActive: true },
  { name: 'Implementation AMC', sku: 'SVC-AM-005', category: 'service',  price: 24999,  description: 'Annual maintenance & support contract', isActive: true },
];

/* ─── Seed runner ────────────────────────────────────────────────── */

async function seed() {
  await connectDB();
  console.log('🌱  Seeding database …');

  /* Wipe existing data */
  await Promise.all([
    User.deleteMany({}),
    Agent.deleteMany({}),
    Product.deleteMany({}),
    Expo.deleteMany({}),
    Lead.deleteMany({}),
  ]);
  console.log('   Cleared existing collections');

  /* Users */
  const users = await User.insertMany(
    await Promise.all(
      USERS_SEED.map(async u => ({
        ...u,
        password: await bcrypt.hash(u.password, 12),
      }))
    )
  );
  const userMap = Object.fromEntries(users.map(u => [u.email, u._id]));
  console.log(`   Created ${users.length} users`);

  /* Agents */
  const agents = await Agent.insertMany(
    AGENTS_SEED.map(a => ({
      ...a,
      userId: userMap[a.email] || null,
      createdBy: userMap['admin@iinvsys.com'],
    }))
  );
  const agentMap = Object.fromEntries(agents.map(a => [a.email, a._id]));
  console.log(`   Created ${agents.length} agents`);

  /* Link agent IDs back to user records */
  await Promise.all(
    AGENTS_SEED.filter(a => userMap[a.email]).map(a =>
      User.findByIdAndUpdate(userMap[a.email], { agentId: agentMap[a.email] })
    )
  );

  /* Products */
  const products = await Product.insertMany(
    PRODUCTS_SEED.map(p => ({ ...p, createdBy: userMap['admin@iinvsys.com'] }))
  );
  const [lite, pro, ent, scanner, amc] = products;
  console.log(`   Created ${products.length} products`);

  /* Expos */
  const now = new Date();
  const expos = await Expo.create([
    {
      name: 'PropTech Expo Delhi 2025',
      startDate: new Date(now.getTime() - 60 * 86400000),
      endDate:   new Date(now.getTime() - 57 * 86400000),
      venue: 'Pragati Maidan', city: 'Delhi',
      agents: [agents[0]._id, agents[1]._id],
      targetLeads: 200,
      createdBy: userMap['admin@iinvsys.com'],
    },
    {
      name: 'SmartRetail Mumbai 2025',
      startDate: new Date(now.getTime() - 5 * 86400000),
      endDate:   new Date(now.getTime() + 2 * 86400000),
      venue: 'MMRDA Grounds', city: 'Mumbai',
      agents: [agents[1]._id, agents[2]._id],
      targetLeads: 150,
      createdBy: userMap['admin@iinvsys.com'],
    },
    {
      name: 'Bengaluru Tech Summit 2025',
      startDate: new Date(now.getTime() + 30 * 86400000),
      endDate:   new Date(now.getTime() + 33 * 86400000),
      venue: 'BIEC', city: 'Bangalore',
      agents: [agents[2]._id, agents[4]._id],
      targetLeads: 180,
      createdBy: userMap['admin@iinvsys.com'],
    },
  ]);
  console.log(`   Created ${expos.length} expos`);

  /* Leads */
  const twoWeeksAgo = new Date(now.getTime() - 14 * 86400000);
  const oneWeekAgo  = new Date(now.getTime() -  7 * 86400000);
  const threeDaysAgo = new Date(now.getTime() - 3 * 86400000);
  const yesterday   = new Date(now.getTime() -  1 * 86400000);

  const leadsData = [
    { name: 'Vikram Nair',       phone: '9100000001', email: 'vikram@nairco.com',    source: 'expo',     expo: expos[0]._id, stage: 'proposal',     assignedAgent: agents[0]._id, products: [pro._id],                   value: 79999,  score: 82, lastContact: threeDaysAgo },
    { name: 'Ananya Krishnan',   phone: '9100000002', email: 'ananya@kstore.in',     source: 'expo',     expo: expos[0]._id, stage: 'negotiation',  assignedAgent: agents[0]._id, products: [ent._id, amc._id],          value: 224998, score: 91, lastContact: yesterday },
    { name: 'Suresh Patel',      phone: '9100000003', email: 'suresh@patelmart.com', source: 'referral', stage: 'won',        assignedAgent: agents[0]._id, products: [pro._id, scanner._id],    value: 94998,  score: 95, lastContact: threeDaysAgo },
    { name: 'Deepa Menon',       phone: '9100000004', email: 'deepa@menonfash.com',  source: 'digital',  stage: 'contacted',  assignedAgent: agents[1]._id, products: [lite._id],                  value: 29999,  score: 55, lastContact: oneWeekAgo },
    { name: 'Rajesh Kumar',      phone: '9100000005', email: 'rajesh@rkwholesale.in',source: 'expo',     expo: expos[1]._id, stage: 'interested',   assignedAgent: agents[1]._id, products: [pro._id, amc._id],          value: 104998, score: 70, lastContact: threeDaysAgo },
    { name: 'Kavitha Reddy',     phone: '9100000006', email: 'kavitha@redmart.com',  source: 'direct',   stage: 'new',        assignedAgent: agents[1]._id, products: [],                          value: 0,      score: 40, lastContact: null },
    { name: 'Mohan Das',         phone: '9100000007', email: 'mohan@daslogistics.com',source:'referral', stage: 'lost',       assignedAgent: agents[2]._id, products: [lite._id],                  value: 29999,  score: 20, lastContact: twoWeeksAgo, lostReason: 'Went with competitor' },
    { name: 'Pooja Shah',        phone: '9100000008', email: 'pooja@shahretail.in',  source: 'digital',  stage: 'proposal',   assignedAgent: agents[2]._id, products: [pro._id],                   value: 79999,  score: 75, lastContact: yesterday },
    { name: 'Arjun Nambiar',     phone: '9100000009', email: 'arjun@nambco.com',     source: 'expo',     expo: expos[1]._id, stage: 'contacted',    assignedAgent: agents[2]._id, products: [ent._id],                   value: 199999, score: 60, lastContact: twoWeeksAgo },
    { name: 'Shalini Tiwari',    phone: '9100000010', email: 'shalini@tiwarigroup.com',source:'referral', stage: 'interested', assignedAgent: agents[3]._id, products: [pro._id, scanner._id],    value: 94998,  score: 68, lastContact: threeDaysAgo },
    { name: 'Ravi Shankar',      phone: '9100000011', email: 'ravi@shankartech.io',  source: 'digital',  stage: 'negotiation',assignedAgent: agents[3]._id, products: [ent._id, amc._id, scanner._id], value: 239997, score: 88, lastContact: yesterday },
    { name: 'Meera Iyer',        phone: '9100000012', email: 'meera@iyertextiles.com',source:'direct',   stage: 'new',        assignedAgent: agents[4]._id, products: [],                          value: 0,      score: 35, lastContact: null },
    { name: 'Sandeep Bhatt',     phone: '9100000013', email: 'sandeep@bhattdist.com',source: 'expo',     expo: expos[0]._id, stage: 'won',          assignedAgent: agents[4]._id, products: [lite._id, amc._id],         value: 54998,  score: 93, lastContact: threeDaysAgo },
    { name: 'Lakshmi Prasad',    phone: '9100000014', email: 'lakshmi@prasadstores.in',source:'referral', stage: 'proposal',  assignedAgent: agents[5]._id, products: [pro._id],                   value: 79999,  score: 78, lastContact: oneWeekAgo },
    { name: 'Nitin Agarwal',     phone: '9100000015', email: 'nitin@agarwalelec.com',source: 'digital',  stage: 'contacted',  assignedAgent: agents[5]._id, products: [scanner._id],              value: 14999,  score: 50, lastContact: threeDaysAgo },
  ];

  const adminId = userMap['admin@iinvsys.com'];
  const leads = await Lead.insertMany(leadsData.map(l => ({ ...l, createdBy: adminId })));
  console.log(`   Created ${leads.length} leads`);

  console.log('\n✅  Seed complete!\n');
  console.log('Demo credentials:');
  console.log('  superadmin  →  admin@iinvsys.com   / Admin@123');
  console.log('  manager     →  sneha@iinvsys.com   / Manager@123');
  console.log('  agent       →  rahul@iinvsys.com   / Agent@123');
  console.log('  readonly    →  readonly@iinvsys.com / Read@1234\n');
  await mongoose.disconnect();
}

seed().catch(err => { console.error(err); process.exit(1); });
