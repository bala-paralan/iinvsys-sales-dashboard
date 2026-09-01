'use strict';
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const User     = require('../models/User');
const Product  = require('../models/Product');
const Expo     = require('../models/Expo');
const Lead     = require('../models/Lead');
const Customer = require('../models/Customer');
const Activity = require('../models/Activity');
const Task     = require('../models/Task');
const Approval = require('../models/Approval');
const CoachingNote = require('../models/CoachingNote');
const connectDB = require('../config/db');
const orgService = require('../services/orgService');
const customerService = require('../services/customerService');

/*
 * The ERP Bible V3 org chart, using the names the documents themselves use — so a
 * screenshot of the running app and the corresponding page of the spec show the same
 * people, and a reviewer at a phase gate can check one against the other.
 *
 * `reportsTo` is an EMAIL here and resolved to an id below. Reporting lines are written
 * through orgService.setManager() rather than by hand, which makes seeding the first
 * real test that the `chain` maintenance works.
 */
const PW = { admin: 'Admin@123', director: 'Director@123', head: 'Head@123', exec: 'Exec@123' };

const USERS_SEED = [
  /* Platform */
  { name: 'Admin IINVSYS', email: 'admin@iinvsys.com', password: PW.admin, role: 'superadmin' },

  /* Sales leadership — doc 1 and doc 2 both hang off this one person */
  { name: 'Sales Director', email: 'director@iinvsys.com', password: PW.director, role: 'sales_director',
    designation: 'Sales Director', territory: 'India', target: 120000000 },

  /* ── Module 1: Inside Sales (doc 1) ─────────────────────────────── */
  { name: 'IS Head', email: 'ishead@iinvsys.com', password: PW.head, role: 'is_head',
    reportsTo: 'director@iinvsys.com', designation: 'Inside Sales Head', target: 0 },
  { name: 'Priya Krishnan', email: 'priya.k@iinvsys.com', password: PW.exec, role: 'is_executive',
    reportsTo: 'ishead@iinvsys.com', designation: 'Sr. IS Executive', color: 'var(--emerald)' },
  { name: 'Rajan V', email: 'rajan.v@iinvsys.com', password: PW.exec, role: 'is_executive',
    reportsTo: 'ishead@iinvsys.com', designation: 'IS Executive', color: 'var(--amber)' },
  { name: 'Suha M', email: 'suha.m@iinvsys.com', password: PW.exec, role: 'is_executive',
    reportsTo: 'ishead@iinvsys.com', designation: 'IS Executive', color: 'var(--azure)' },
  { name: 'Arun K', email: 'arun.k@iinvsys.com', password: PW.exec, role: 'is_executive',
    reportsTo: 'ishead@iinvsys.com', designation: 'IS Executive (New)', color: 'var(--violet)' },

  /* ── Module 2: Sales, four domains, two executives each (doc 2) ── */
  { name: 'Vikram Nair', email: 'vikram.n@iinvsys.com', password: PW.head, role: 'sales_manager',
    reportsTo: 'director@iinvsys.com', domain: 'railways', designation: 'Sales Manager 1', target: 7500000 },
  { name: 'Deepa Rajan', email: 'deepa.r@iinvsys.com', password: PW.head, role: 'sales_manager',
    reportsTo: 'director@iinvsys.com', domain: 'defence', designation: 'Sales Manager 2', target: 5000000 },
  { name: 'Anita Menon', email: 'anita.m@iinvsys.com', password: PW.head, role: 'sales_manager',
    reportsTo: 'director@iinvsys.com', domain: 'space_satellite', designation: 'Sales Manager 3', target: 6000000 },
  { name: 'Karthik P', email: 'karthik.p@iinvsys.com', password: PW.head, role: 'sales_manager',
    reportsTo: 'director@iinvsys.com', domain: 'automotive', designation: 'Sales Manager 4', target: 4000000 },

  { name: 'Exec A', email: 'exec.a@iinvsys.com', password: PW.exec, role: 'sales_executive',
    reportsTo: 'vikram.n@iinvsys.com', domain: 'railways', territory: 'Delhi NCR', target: 5000000 },
  { name: 'Exec B', email: 'exec.b@iinvsys.com', password: PW.exec, role: 'sales_executive',
    reportsTo: 'vikram.n@iinvsys.com', domain: 'railways', territory: 'Chennai', target: 3000000 },
  { name: 'Exec C', email: 'exec.c@iinvsys.com', password: PW.exec, role: 'sales_executive',
    reportsTo: 'deepa.r@iinvsys.com', domain: 'defence', territory: 'Bangalore', target: 4000000 },
  { name: 'Exec D', email: 'exec.d@iinvsys.com', password: PW.exec, role: 'sales_executive',
    reportsTo: 'deepa.r@iinvsys.com', domain: 'defence', territory: 'Hyderabad', target: 3000000 },
  { name: 'Exec E', email: 'exec.e@iinvsys.com', password: PW.exec, role: 'sales_executive',
    reportsTo: 'anita.m@iinvsys.com', domain: 'space_satellite', territory: 'Bangalore', target: 3500000 },
  { name: 'Exec F', email: 'exec.f@iinvsys.com', password: PW.exec, role: 'sales_executive',
    reportsTo: 'anita.m@iinvsys.com', domain: 'space_satellite', territory: 'Trivandrum', target: 3000000 },
  { name: 'Exec G', email: 'exec.g@iinvsys.com', password: PW.exec, role: 'sales_executive',
    reportsTo: 'karthik.p@iinvsys.com', domain: 'automotive', territory: 'Pune', target: 3000000 },
  { name: 'Exec H', email: 'exec.h@iinvsys.com', password: PW.exec, role: 'sales_executive',
    reportsTo: 'karthik.p@iinvsys.com', domain: 'automotive', territory: 'Chennai', target: 2500000 },

  /* ── Module 3: Production & Delivery (doc 3) ─────────────────────── */
  { name: 'Production Head', email: 'prodhead@iinvsys.com', password: PW.head, role: 'production_head',
    designation: 'Production Head' },
  { name: 'Suresh R', email: 'suresh.r@iinvsys.com', password: PW.exec, role: 'production_engineer',
    reportsTo: 'prodhead@iinvsys.com', designation: 'Production Engineer' },
  { name: 'Ramesh M', email: 'ramesh.m@iinvsys.com', password: PW.exec, role: 'production_engineer',
    reportsTo: 'prodhead@iinvsys.com', designation: 'Production Engineer' },
  { name: 'Anil K', email: 'anil.k@iinvsys.com', password: PW.exec, role: 'production_engineer',
    reportsTo: 'prodhead@iinvsys.com', designation: 'Production Engineer' },

  /* ── Module 4: Installation & Customer Support (doc 4) ───────────── */
  { name: 'Install Head', email: 'installhead@iinvsys.com', password: PW.head, role: 'install_head',
    designation: 'Installation Head' },
  { name: 'Kumar R', email: 'kumar.r@iinvsys.com', password: PW.exec, role: 'field_engineer',
    reportsTo: 'installhead@iinvsys.com', designation: 'Field Engineer' },
  { name: 'Senthil M', email: 'senthil.m@iinvsys.com', password: PW.exec, role: 'field_engineer',
    reportsTo: 'installhead@iinvsys.com', designation: 'Field Engineer' },

  { name: 'CS Manager', email: 'csmanager@iinvsys.com', password: PW.head, role: 'cs_manager',
    designation: 'Customer Support Manager' },
  { name: 'Agent Priya', email: 'agent.priya@iinvsys.com', password: PW.exec, role: 'cs_agent',
    reportsTo: 'csmanager@iinvsys.com', designation: 'CS Agent' },
  { name: 'Agent Kiran', email: 'agent.kiran@iinvsys.com', password: PW.exec, role: 'cs_agent',
    reportsTo: 'csmanager@iinvsys.com', designation: 'CS Agent' },
];

/* The accounts the specification's screenshots are drawn from. */
const CUSTOMERS_SEED = [
  { name: 'DMRC Delhi', city: 'Delhi', state: 'Delhi', domain: 'railways', owner: 'exec.a@iinvsys.com',
    contacts: [
      { name: 'A. Kumar', designation: 'GM Operations', isPrimary: true },
      { name: 'Rajesh Kumar', designation: 'DGM Rolling Stock' },
      { name: 'Priya Shah', designation: 'CFO' },
    ] },
  { name: 'ICF Chennai', city: 'Chennai', state: 'Tamil Nadu', domain: 'railways', owner: 'rajan.v@iinvsys.com',
    contacts: [
      { name: 'K. Subramaniam', designation: 'Sr. Manager – Procurement', isPrimary: true },
      { name: 'V. Krishnaswamy', designation: 'DGM – Rolling Stock' },
      { name: 'R. Balachandran', designation: 'GM (Technical)' },
    ] },
  { name: 'RVNL Mumbai', city: 'Mumbai', state: 'Maharashtra', domain: 'railways', owner: 'exec.a@iinvsys.com',
    contacts: [{ name: 'S. Deshpande', designation: 'Procurement Manager', isPrimary: true }] },
  { name: 'BEL Defence', city: 'Bangalore', state: 'Karnataka', domain: 'defence', owner: 'exec.c@iinvsys.com',
    contacts: [{ name: 'Lt. Col. V. Sharma', designation: 'Project Manager', isPrimary: true }] },
  { name: 'BEL Sensors', city: 'Bangalore', state: 'Karnataka', domain: 'iot_iiot', owner: 'exec.c@iinvsys.com',
    contacts: [{ name: 'K. Narayana', designation: 'Logistics Head', isPrimary: true }] },
  { name: 'BHEL Trichy', city: 'Trichy', state: 'Tamil Nadu', domain: 'railways', owner: 'rajan.v@iinvsys.com',
    contacts: [{ name: 'Dilip Nair', designation: 'Sr. Manager – Projects', isPrimary: true }] },
  { name: 'Ashok Leyland', city: 'Pune', state: 'Maharashtra', domain: 'automotive', owner: 'exec.g@iinvsys.com',
    contacts: [{ name: 'Meera S', designation: 'GM – Manufacturing', isPrimary: true }] },
];

const PRODUCTS_SEED = [
  { name: 'ConnectSei Rolling Stock Monitor', sku: 'CS-RSM-001', category: 'hardware', price: 912000, description: 'IoT condition monitoring for LHB coaches', isActive: true },
  { name: 'IIoT Edge Gateway',                sku: 'IIOT-EG-002', category: 'hardware', price: 495000, description: 'DIN-rail edge gateway, IP67, OPC-UA + MQTT', isActive: true },
  { name: 'Vibration Sensor IoT Kit',         sku: 'VS-IOT-003', category: 'bundle',   price: 114000, description: 'Wireless vibration + temperature sensing kit', isActive: true },
  { name: 'Railway Sensor Module',            sku: 'RSM-004',    category: 'hardware', price: 36600,  description: 'Track-side sensor module, IEC 60068 rated', isActive: true },
  { name: 'ConnectSei Platform Licence',      sku: 'CS-PLT-005', category: 'software', price: 299000, description: 'Annual platform licence, per site', isActive: true },
  { name: 'Implementation AMC',               sku: 'SVC-AM-006', category: 'service',  price: 180000, description: 'Annual maintenance & support contract', isActive: true },
];

/* ─── Seed runner ────────────────────────────────────────────────── */

async function seed() {
  await connectDB();
  console.log('🌱  Seeding database …');

  await Promise.all([
    User.deleteMany({}), Product.deleteMany({}), Expo.deleteMany({}), Lead.deleteMany({}),
    Customer.deleteMany({}), Activity.deleteMany({}), Task.deleteMany({}),
    Approval.deleteMany({}), CoachingNote.deleteMany({}),
  ]);
  console.log('   Cleared existing collections');

  /* Users, then reporting lines. Two passes because a manager must exist before anyone
     can point at them, and `chain` is written from the manager's own chain. */
  const users = await User.insertMany(await Promise.all(
    USERS_SEED.map(async ({ reportsTo, ...u }) => ({ ...u, password: await bcrypt.hash(u.password, 12) })),
  ));
  const byEmail = Object.fromEntries(users.map((u) => [u.email, u._id]));

  for (const u of USERS_SEED) {
    if (u.reportsTo) await orgService.setManager(byEmail[u.email], byEmail[u.reportsTo]);
  }
  console.log(`   Created ${users.length} users and wired the org chart`);

  const adminId = byEmail['admin@iinvsys.com'];

  const products = await Product.insertMany(PRODUCTS_SEED.map((p) => ({ ...p, createdBy: adminId })));
  console.log(`   Created ${products.length} products`);

  /* Customers — without these there is nothing for Customer 360 or the activity
     timeline to render, and the Phase 0 gate has nothing to look at. */
  const customers = [];
  for (const c of CUSTOMERS_SEED) {
    const owner = byEmail[c.owner];
    const ownerUser = await User.findById(owner).select('reportsTo').lean();
    const { customer } = await customerService.findOrCreateCustomer({
      ...c, accountOwner: owner, accountManager: ownerUser ? ownerUser.reportsTo : null,
    }, { actorId: adminId });
    customers.push(customer);
  }
  const custByName = Object.fromEntries(customers.map((c) => [c.name, c]));
  console.log(`   Created ${customers.length} customers`);

  const now = new Date();
  const daysAgo = (n) => new Date(now.getTime() - n * 86400000);

  /* A small spread of leads across both tracks, so the Kanban, the review queue and the
     scope tests all have something real to run against. */
  const leadsData = [
    { name: 'K. Subramaniam', phone: '9100000001', email: 'k.subramaniam@icf.gov.in', company: 'ICF Chennai',
      customer: custByName['ICF Chennai']._id, track: 'inside_sales', refId: 'IS-2026-0047',
      source: 'inside_sales_outbound', stage: 'suspect', owner: byEmail['rajan.v@iinvsys.com'], value: 0 },
    { name: 'Dilip Nair', phone: '9100000002', email: 'dilip.n@bhel.in', company: 'BHEL Trichy',
      customer: custByName['BHEL Trichy']._id, track: 'inside_sales', refId: 'IS-2026-0051',
      source: 'inbound_enquiry', stage: 'prospect', owner: byEmail['rajan.v@iinvsys.com'], value: 7000000 },
    { name: 'Meera S', phone: '9100000003', email: 'meera.s@ashokleyland.com', company: 'Ashok Leyland',
      customer: custByName['Ashok Leyland']._id, track: 'inside_sales', refId: 'IS-2026-0058',
      source: 'inside_sales_outbound', stage: 'engagement', owner: byEmail['priya.k@iinvsys.com'], value: 10000000 },

    { name: 'Rajesh Kumar', phone: '9100000004', email: 'rajesh.k@dmrc.org', company: 'DMRC Delhi',
      customer: custByName['DMRC Delhi']._id, track: 'sales', refId: 'SA-2026-041',
      source: 'referral', stage: 'negotiation', owner: byEmail['exec.a@iinvsys.com'],
      products: [products[0]._id], value: 48000000, lastContact: daysAgo(1) },
    { name: 'S. Deshpande', phone: '9100000005', email: 's.deshpande@rvnl.in', company: 'RVNL Mumbai',
      customer: custByName['RVNL Mumbai']._id, track: 'sales', refId: 'SA-2026-036',
      source: 'referral', stage: 'negotiation', owner: byEmail['exec.a@iinvsys.com'],
      products: [products[3]._id], value: 7800000, lastContact: daysAgo(3) },
    { name: 'Lt. Col. V. Sharma', phone: '9100000006', email: 'v.sharma@bel.co.in', company: 'BEL Defence',
      customer: custByName['BEL Defence']._id, track: 'sales', refId: 'SA-2026-038',
      source: 'referral', stage: 'engagement', owner: byEmail['exec.c@iinvsys.com'],
      products: [products[1]._id], value: 21000000, lastContact: daysAgo(2) },
    { name: 'K. Narayana', phone: '9100000007', email: 'k.narayana@bel.co.in', company: 'BEL Sensors',
      customer: custByName['BEL Sensors']._id, track: 'sales', refId: 'SA-2026-029',
      source: 'exhibition_event', stage: 'prospect', owner: byEmail['exec.d@iinvsys.com'],
      products: [products[2]._id], value: 11400000, lastContact: daysAgo(5) },
    { name: 'A. Kumar', phone: '9100000008', email: 'a.kumar@dmrc.org', company: 'DMRC Delhi',
      customer: custByName['DMRC Delhi']._id, track: 'sales', refId: 'SA-2026-012',
      source: 'referral', stage: 'suspect', owner: byEmail['exec.b@iinvsys.com'], value: 0 },
  ];
  const leads = await Lead.insertMany(leadsData.map((l) => ({ ...l, createdBy: adminId })));
  console.log(`   Created ${leads.length} leads (${leadsData.filter((l) => l.track === 'inside_sales').length} inside sales, ${leadsData.filter((l) => l.track === 'sales').length} sales)`);

  /* A couple of timelines, so the Customer 360 screen is demonstrable. */
  const icf = custByName['ICF Chennai']._id;
  const dmrc = custByName['DMRC Delhi']._id;
  const activities = await Activity.insertMany([
    { customer: icf, deal: leads[0]._id, type: 'email', occurredAt: daysAgo(27), by: byEmail['rajan.v@iinvsys.com'],
      summary: 'Cold outreach via LinkedIn connection. Introduced iinvsys Railways IoT capabilities.',
      contact: { name: 'K. Subramaniam', designation: 'Sr. Manager – Procurement' } },
    { customer: icf, deal: leads[0]._id, type: 'call', occurredAt: daysAgo(22), durationMinutes: 18,
      outcome: 'connected_positive', by: byEmail['rajan.v@iinvsys.com'],
      summary: 'ICF evaluating IoT for condition monitoring on LHB coaches. Budget discussion deferred — needs DGM approval.',
      bantUpdate: 'need', contact: { name: 'K. Subramaniam', designation: 'Sr. Manager – Procurement' } },
    { customer: icf, deal: leads[0]._id, type: 'email', occurredAt: daysAgo(17), by: byEmail['rajan.v@iinvsys.com'],
      summary: 'Sent iinvsys IoT for Railways brochure + ConnectSei platform overview. Awaiting acknowledgement.' },
    { customer: dmrc, deal: leads[3]._id, type: 'visit', occurredAt: daysAgo(12), by: byEmail['exec.a@iinvsys.com'],
      summary: 'Live demo of ConnectSei rolling stock monitor at DMRC HQ. 8 stakeholders present. Proposal requested.',
      contact: { name: 'Rajesh Kumar', designation: 'DGM Rolling Stock' } },
    { customer: dmrc, deal: leads[3]._id, type: 'call', occurredAt: daysAgo(1), durationMinutes: 18,
      outcome: 'connected_positive', by: byEmail['exec.a@iinvsys.com'],
      summary: 'DGM confirmed attendance at the FAT. Requested revised proposal with payment milestones.' },
  ]);
  await Lead.updateOne({ _id: leads[0]._id }, { $set: { lastActivityAt: daysAgo(17) } });
  await Lead.updateOne({ _id: leads[3]._id }, { $set: { lastActivityAt: daysAgo(1) } });
  console.log(`   Created ${activities.length} activities`);

  const tasks = await Task.insertMany([
    { owner: byEmail['rajan.v@iinvsys.com'], customer: icf, deal: leads[0]._id,
      title: 'Follow-up call — K. Subramaniam, ICF Chennai', type: 'call',
      dueAt: daysAgo(2), source: 'activity_next_action', createdBy: adminId },
    { owner: byEmail['exec.a@iinvsys.com'], customer: dmrc, deal: leads[3]._id,
      title: 'Send revised proposal with payment milestones', type: 'proposal',
      dueAt: new Date(now.getTime() + 86400000), source: 'activity_next_action', createdBy: adminId },
  ]);
  console.log(`   Created ${tasks.length} tasks`);

  await CoachingNote.create({
    about: byEmail['rajan.v@iinvsys.com'], author: byEmail['director@iinvsys.com'],
    body: 'Response time consistently above 2h. Discovery questions too surface-level. '
        + 'Suggested shadow call with Priya K. No follow-through on the ICF Chennai lead in 5 days.',
  });

  console.log('\n✅  Seed complete!\n');
  console.log('Demo credentials — every role in ERP Bible V3:');
  for (const u of USERS_SEED) console.log(`  ${u.role.padEnd(20)} →  ${u.email.padEnd(28)} / ${u.password}`);
  console.log('');
  await mongoose.disconnect();
}

if (require.main === module) {
  seed().catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { seed, USERS_SEED, CUSTOMERS_SEED, PRODUCTS_SEED };
