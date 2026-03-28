'use strict';
const request = require('supertest');
const app     = require('../src/app');
const db      = require('./helpers/db');
const User    = require('../src/models/User');

beforeAll(async () => {
  await db.connect();
});

afterEach(async () => {
  await db.clearCollections();
});

afterAll(async () => {
  await db.disconnect();
});

/* ─── helpers ────────────────────────────────────────────────────── */

async function createUser(overrides = {}) {
  return User.create({
    name:     'Test Admin',
    email:    'admin@test.com',
    password: 'Admin@1234',
    role:     'superadmin',
    isActive: true,
    ...overrides,
  });
}

async function loginAs(email = 'admin@test.com', password = 'Admin@1234') {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  return res.body.data?.token;
}

/* ─── tests ──────────────────────────────────────────────────────── */

describe('POST /api/auth/login', () => {
  it('returns 401 when user does not exist', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'ghost@test.com', password: 'pass' });
    expect(res.status).toBe(401);
  });

  it('returns 401 for wrong password', async () => {
    await createUser();
    const res = await request(app).post('/api/auth/login').send({ email: 'admin@test.com', password: 'wrongpass' });
    expect(res.status).toBe(401);
  });

  it('returns token on successful login', async () => {
    await createUser();
    const res = await request(app).post('/api/auth/login').send({ email: 'admin@test.com', password: 'Admin@1234' });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('token');
    expect(res.body.data.user.email).toBe('admin@test.com');
  });

  it('returns 401 for deactivated account', async () => {
    await createUser({ isActive: false });
    const res = await request(app).post('/api/auth/login').send({ email: 'admin@test.com', password: 'Admin@1234' });
    expect(res.status).toBe(401);
  });

  it('returns 422 for invalid email format', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'not-an-email', password: 'pass' });
    expect(res.status).toBe(422);
  });
});

describe('GET /api/auth/me', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns user profile with valid token', async () => {
    await createUser();
    const token = await loginAs();
    const res   = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe('admin@test.com');
    expect(res.body.data.user).not.toHaveProperty('password');
  });
});

describe('POST /api/auth/register', () => {
  it('allows superadmin to create users', async () => {
    await createUser();
    const token = await loginAs();
    const res   = await request(app)
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'New User', email: 'new@test.com', password: 'NewPass@1', role: 'agent' });
    expect(res.status).toBe(201);
    expect(res.body.data.user.email).toBe('new@test.com');
  });

  it('blocks non-superadmin from registering users', async () => {
    await createUser({ role: 'manager', email: 'manager@test.com' });
    const token = await loginAs('manager@test.com');
    const res   = await request(app)
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'X', email: 'x@test.com', password: 'XPass@123', role: 'agent' });
    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/auth/password', () => {
  it('changes password successfully', async () => {
    await createUser();
    const token = await loginAs();
    const res   = await request(app)
      .patch('/api/auth/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'Admin@1234', newPassword: 'NewAdmin@5678' });
    expect(res.status).toBe(200);

    /* Can now login with new password */
    const loginRes = await request(app).post('/api/auth/login').send({ email: 'admin@test.com', password: 'NewAdmin@5678' });
    expect(loginRes.status).toBe(200);
  });

  it('rejects wrong current password', async () => {
    await createUser();
    const token = await loginAs();
    const res   = await request(app)
      .patch('/api/auth/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'wrongpass', newPassword: 'NewAdmin@5678' });
    expect(res.status).toBe(401);
  });
});
