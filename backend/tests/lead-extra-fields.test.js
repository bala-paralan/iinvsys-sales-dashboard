'use strict';
const request = require('supertest');
const app     = require('../src/app');
const db      = require('./helpers/db');
const User    = require('../src/models/User');
const Agent   = require('../src/models/Agent');
const Lead    = require('../src/models/Lead');

beforeAll(async () => { await db.connect(); });
afterEach(async () => { await db.clearCollections(); });
afterAll(async () => { await db.disconnect(); });

async function setup() {
  const mgr = await User.create({ name: 'Mgr', email: 'mgr@t.com', password: 'Pass@1234', role: 'manager', isActive: true });
  const agentProfile = await Agent.create({
    name: 'A1', initials: 'A1', email: 'a1@t.com', phone: '9000000001',
    territory: 'Pune', designation: 'Sales', createdBy: mgr._id,
  });
  const res = await request(app).post('/api/auth/login').send({ email: 'mgr@t.com', password: 'Pass@1234' });
  return { token: res.body.data.token, agentId: agentProfile._id.toString() };
}

describe('Lead — extra optional fields (city, state, natureOfBusiness, interestedIn)', () => {
  test('Lead model exports the enum lists', () => {
    expect(Lead.NATURE_OF_BUSINESS).toContain('system-integrator');
    expect(Lead.NATURE_OF_BUSINESS).toContain('end-consumer');
    expect(Lead.NATURE_OF_BUSINESS).toContain('other');
    expect(Lead.INTERESTED_IN).toContain('dealership');
    expect(Lead.INTERESTED_IN).toContain('direct-purchase');
    expect(Lead.INTERESTED_IN).toContain('other');
  });

  test('POST /api/leads — accepts and persists all four new fields', async () => {
    const { token, agentId } = await setup();
    const res = await request(app)
      .post('/api/leads')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Test User', phone: '+91 99999 00000', source: 'direct',
        assignedAgent: agentId,
        city: 'Pune', state: 'Maharashtra',
        natureOfBusiness: 'system-integrator',
        interestedIn: 'direct-purchase',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.city).toBe('Pune');
    expect(res.body.data.state).toBe('Maharashtra');
    expect(res.body.data.natureOfBusiness).toBe('system-integrator');
    expect(res.body.data.interestedIn).toBe('direct-purchase');
  });

  test('POST /api/leads — rejects invalid natureOfBusiness enum', async () => {
    const { token, agentId } = await setup();
    const res = await request(app)
      .post('/api/leads')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'X', phone: '+91 88888 00000', source: 'direct',
        assignedAgent: agentId,
        natureOfBusiness: 'not-a-real-value',
      });
    expect(res.status).toBe(422);
  });

  test('POST /api/leads — rejects invalid interestedIn enum', async () => {
    const { token, agentId } = await setup();
    const res = await request(app)
      .post('/api/leads')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Y', phone: '+91 77777 00000', source: 'direct',
        assignedAgent: agentId,
        interestedIn: 'lease',
      });
    expect(res.status).toBe(422);
  });

  test('POST /api/leads — empty strings allowed (fields are optional)', async () => {
    const { token, agentId } = await setup();
    const res = await request(app)
      .post('/api/leads')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Z', phone: '+91 66666 00000', source: 'direct',
        assignedAgent: agentId,
        city: '', state: '', natureOfBusiness: '', interestedIn: '',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.city).toBe('');
    expect(res.body.data.natureOfBusiness).toBe('');
  });

  test('PUT /api/leads/:id — manager can update the four fields', async () => {
    const { token, agentId } = await setup();
    const create = await request(app).post('/api/leads').set('Authorization', `Bearer ${token}`).send({
      name: 'L', phone: '+91 55555 00000', source: 'direct', assignedAgent: agentId,
    });
    const id = create.body.data._id;

    const upd = await request(app).put(`/api/leads/${id}`).set('Authorization', `Bearer ${token}`).send({
      city: 'Mumbai', state: 'Maharashtra',
      natureOfBusiness: 'distribution', interestedIn: 'dealership',
    });
    expect(upd.status).toBe(200);
    expect(upd.body.data.city).toBe('Mumbai');
    expect(upd.body.data.natureOfBusiness).toBe('distribution');
    expect(upd.body.data.interestedIn).toBe('dealership');
  });

  test('GET /api/leads — can filter on the new fields', async () => {
    const { token, agentId } = await setup();
    await request(app).post('/api/leads').set('Authorization', `Bearer ${token}`).send({
      name: 'A', phone: '111', source: 'direct', assignedAgent: agentId,
      city: 'Pune', natureOfBusiness: 'manufacturer', interestedIn: 'collaboration',
    });
    await request(app).post('/api/leads').set('Authorization', `Bearer ${token}`).send({
      name: 'B', phone: '222', source: 'direct', assignedAgent: agentId,
      city: 'Mumbai', natureOfBusiness: 'reseller', interestedIn: 'direct-purchase',
    });

    /* Direct DB filter (filter wiring on the GET endpoint isn't part of this PR
       — verifying the model + indexes support querying on the new fields). */
    const found = await Lead.find({ natureOfBusiness: 'manufacturer' }).lean();
    expect(found).toHaveLength(1);
    expect(found[0].name).toBe('A');

    const interestFiltered = await Lead.find({ interestedIn: 'direct-purchase' }).lean();
    expect(interestFiltered).toHaveLength(1);
    expect(interestFiltered[0].name).toBe('B');

    const cityFiltered = await Lead.find({ city: 'Pune' }).lean();
    expect(cityFiltered).toHaveLength(1);
    expect(cityFiltered[0].name).toBe('A');
  });

  test('GET /api/leads?city=… filter narrows results', async () => {
    const { token, agentId } = await setup();
    await request(app).post('/api/leads').set('Authorization', `Bearer ${token}`).send({
      name: 'P1', phone: '811', source: 'direct', assignedAgent: agentId, city: 'Pune',
    });
    await request(app).post('/api/leads').set('Authorization', `Bearer ${token}`).send({
      name: 'M1', phone: '812', source: 'direct', assignedAgent: agentId, city: 'Mumbai',
    });
    const res = await request(app).get('/api/leads?city=Pune').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('P1');
  });

  test('GET /api/leads?natureOfBusiness=… and ?interestedIn=… filter narrows results', async () => {
    const { token, agentId } = await setup();
    await request(app).post('/api/leads').set('Authorization', `Bearer ${token}`).send({
      name: 'A', phone: '901', source: 'direct', assignedAgent: agentId,
      natureOfBusiness: 'manufacturer', interestedIn: 'collaboration',
    });
    await request(app).post('/api/leads').set('Authorization', `Bearer ${token}`).send({
      name: 'B', phone: '902', source: 'direct', assignedAgent: agentId,
      natureOfBusiness: 'reseller', interestedIn: 'direct-purchase',
    });

    const byNature = await request(app).get('/api/leads?natureOfBusiness=manufacturer').set('Authorization', `Bearer ${token}`);
    expect(byNature.status).toBe(200);
    expect(byNature.body.data).toHaveLength(1);
    expect(byNature.body.data[0].name).toBe('A');

    const byInterest = await request(app).get('/api/leads?interestedIn=direct-purchase').set('Authorization', `Bearer ${token}`);
    expect(byInterest.status).toBe(200);
    expect(byInterest.body.data).toHaveLength(1);
    expect(byInterest.body.data[0].name).toBe('B');

    /* Combined filters AND together */
    const combined = await request(app).get('/api/leads?natureOfBusiness=reseller&interestedIn=direct-purchase').set('Authorization', `Bearer ${token}`);
    expect(combined.status).toBe(200);
    expect(combined.body.data).toHaveLength(1);
    expect(combined.body.data[0].name).toBe('B');

    const noMatch = await request(app).get('/api/leads?natureOfBusiness=manufacturer&interestedIn=direct-purchase').set('Authorization', `Bearer ${token}`);
    expect(noMatch.body.data).toHaveLength(0);
  });

  test('POST /api/leads/bulk — accepts new fields in CSV-style rows', async () => {
    const { token, agentId } = await setup();
    const res = await request(app)
      .post('/api/leads/bulk')
      .set('Authorization', `Bearer ${token}`)
      .send({
        leads: [
          { name: 'B1', phone: '+91 11111 00001', source: 'direct', assignedAgent: agentId,
            city: 'Pune', state: 'MH', natureOfBusiness: 'oem', interestedIn: 'product-integration' },
          { name: 'B2', phone: '+91 11111 00002', source: 'direct', assignedAgent: agentId,
            city: 'Mumbai', state: 'MH', natureOfBusiness: 'reseller', interestedIn: 'dealership' },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.data.imported).toBe(2);

    const all = await Lead.find({}).sort({ name: 1 }).lean();
    expect(all[0].natureOfBusiness).toBe('oem');
    expect(all[0].interestedIn).toBe('product-integration');
    expect(all[1].natureOfBusiness).toBe('reseller');
    expect(all[1].city).toBe('Mumbai');
  });
});
