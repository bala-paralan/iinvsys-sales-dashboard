'use strict';
const { MongoMemoryServer } = require('mongodb-memory-server');

module.exports = async function globalSetup() {
  const mongod = await MongoMemoryServer.create();
  process.env.MONGO_URI  = mongod.getUri();
  process.env.JWT_SECRET = 'test-secret-key-for-jest';
  process.env.NODE_ENV   = 'test';
  global.__MONGOD__      = mongod;
};
