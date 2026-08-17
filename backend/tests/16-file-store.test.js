'use strict';
/**
 * fileStore — N-6, assumption A25.
 *
 * The document gates (PO before Commercial Order, DA + photo before Delivered,
 * Handover Certificate before Handed Over) are only as good as the storage
 * behind them. Two properties carry the weight here:
 *
 *   1. The declared MIME type is a CLAIM; the magic bytes are the evidence.
 *   2. The `local` driver must refuse to run on Vercel rather than write a
 *      signed Delivery Acknowledgement to a filesystem that vanishes.
 */
const crypto   = require('crypto');
const mongoose = require('mongoose');
const store    = require('../src/utils/fileStore');
const { connect, disconnect } = require('./helpers/db');

/* Minimal but genuine file headers. */
const PDF  = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 0x20)]);
const PNG  = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
const CSV  = Buffer.from('name,phone\nRajesh,9876543210\n');
const ELF  = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(64)]);
const EXE  = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64)]);
const SH   = Buffer.from('#!/bin/sh\nrm -rf /\n');

const ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ENV };
  store.setScanner(null);
});

beforeAll(connect);
afterAll(disconnect);

describe('validate — size and emptiness', () => {
  it('rejects an empty buffer', () => {
    expect(() => store.validate(Buffer.alloc(0), { mimeType: 'application/pdf' }))
      .toThrow(/empty/i);
  });

  it('rejects a non-buffer', () => {
    expect(() => store.validate('not a buffer', { mimeType: 'application/pdf' }))
      .toThrow(/empty/i);
  });

  it('rejects a file over the limit, and says what the limit is', () => {
    const big = Buffer.concat([PDF, Buffer.alloc(2048)]);
    try {
      store.validate(big, { mimeType: 'application/pdf', maxBytes: 1024 });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err.code).toBe('FILE_TOO_LARGE');
      expect(err.message).toMatch(/limit is 1 KB/);
    }
  });

  it('accepts a file exactly at the limit', () => {
    expect(() => store.validate(PDF, { mimeType: 'application/pdf', maxBytes: PDF.length }))
      .not.toThrow();
  });
});

describe('validate — executables are refused outright', () => {
  it.each([
    ['ELF binary', ELF], ['Windows PE', EXE], ['shell script', SH],
  ])('rejects a %s even when a benign type is declared', (_label, buf) => {
    try {
      store.validate(buf, { mimeType: 'application/pdf', filename: 'invoice.pdf' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err.code).toBe('EXECUTABLE_REJECTED');
    }
  });

  it('the executable check runs before the MIME allow-list', () => {
    /* Otherwise a disallowed-type message would mask what was actually sent. */
    try {
      store.validate(ELF, { mimeType: 'application/x-msdownload' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err.code).toBe('EXECUTABLE_REJECTED');
    }
  });
});

describe('validate — declared type vs actual bytes', () => {
  it.each([
    ['application/pdf', PDF], ['image/png', PNG], ['image/jpeg', JPEG], ['text/csv', CSV],
  ])('accepts a genuine %s', (mimeType, buf) => {
    expect(store.validate(buf, { mimeType }).mimeType).toBe(mimeType);
  });

  it('rejects PNG bytes declared as a PDF — the sniff decides, not the claim', () => {
    try {
      store.validate(PNG, { mimeType: 'application/pdf', filename: 'po.pdf' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err.code).toBe('CONTENT_MISMATCH');
    }
  });

  it('rejects a type that is not on the allow-list', () => {
    try {
      store.validate(PDF, { mimeType: 'application/x-shockwave-flash' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err.code).toBe('MIME_NOT_ALLOWED');
    }
  });

  it('rejects binary content declared as text/csv', () => {
    /* CSV has no signature, so the guard is "no NUL bytes". */
    try {
      store.validate(Buffer.from([0x00, 0x01, 0x02, 0x03]), { mimeType: 'text/csv' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err.code).toBe('CONTENT_MISMATCH');
    }
  });

  it('tolerates a charset parameter and odd casing on the declared type', () => {
    expect(store.validate(CSV, { mimeType: 'TEXT/CSV; charset=utf-8' }).mimeType).toBe('text/csv');
  });
});

describe('driver selection', () => {
  it('defaults to gridfs', () => {
    delete process.env.FILE_STORE_DRIVER;
    expect(store.driver().name).toBe('gridfs');
  });

  it('honours FILE_STORE_DRIVER=local off-serverless', () => {
    process.env.FILE_STORE_DRIVER = 'local';
    delete process.env.VERCEL;
    expect(store.driver().name).toBe('local');
  });

  it('REFUSES the local driver on Vercel rather than losing documents', () => {
    process.env.FILE_STORE_DRIVER = 'local';
    process.env.VERCEL = '1';
    try {
      store.driver();
      throw new Error('should have thrown');
    } catch (err) {
      expect(err.code).toBe('LOCAL_DRIVER_ON_SERVERLESS');
      expect(err.message).toMatch(/ephemeral/);
    }
  });

  it('gridfs remains fine on Vercel — that is the whole point of the default', () => {
    process.env.FILE_STORE_DRIVER = 'gridfs';
    process.env.VERCEL = '1';
    expect(store.driver().name).toBe('gridfs');
  });

  it('rejects an unknown driver name', () => {
    process.env.FILE_STORE_DRIVER = 's3';
    expect(() => store.driver()).toThrow(/Unknown FILE_STORE_DRIVER/);
  });
});

describe('virus-scan hook', () => {
  it('is not required — no scanner means no rejection', async () => {
    const res = await store.put(PDF, { filename: 'po.pdf', mimeType: 'application/pdf' });
    expect(res.storageKey).toBeTruthy();
  });

  it('rejects when a registered scanner reports unclean', async () => {
    store.setScanner(async () => ({ clean: false, reason: 'EICAR-Test-File' }));
    await expect(store.put(PDF, { filename: 'po.pdf', mimeType: 'application/pdf' }))
      .rejects.toThrow(/EICAR-Test-File/);
  });

  it('stores nothing when the scan rejects', async () => {
    store.setScanner(async () => ({ clean: false }));
    const before = await mongoose.connection.db.collection('attachments.files').countDocuments();
    await expect(store.put(PDF, { filename: 'po.pdf', mimeType: 'application/pdf' })).rejects.toThrow();
    const after = await mongoose.connection.db.collection('attachments.files').countDocuments();
    expect(after).toBe(before);
  });

  it('the scanner sees the bytes and the metadata', async () => {
    const seen = [];
    store.setScanner(async (buf, meta) => { seen.push([buf.length, meta.docType]); return { clean: true }; });
    await store.put(PDF, { filename: 'po.pdf', mimeType: 'application/pdf', docType: 'po' });
    expect(seen).toEqual([[PDF.length, 'po']]);
  });
});

describe('GridFS round-trip', () => {
  beforeEach(() => { delete process.env.FILE_STORE_DRIVER; });

  it('returns exactly the fields AttachmentSchema requires', async () => {
    const res = await store.put(PDF, {
      filename: 'purchase-order.pdf', mimeType: 'application/pdf',
      docType: 'po', uploadedBy: new mongoose.Types.ObjectId(),
    });

    expect(res).toMatchObject({
      driver: 'gridfs',
      filename: 'purchase-order.pdf',
      mimeType: 'application/pdf',
      sizeBytes: PDF.length,
    });
    expect(res.storageKey).toEqual(expect.any(String));
    expect(res.sha256).toHaveLength(64);
  });

  it('the sha256 is of the actual bytes, so tampering is detectable', async () => {
    const res = await store.put(PDF, { filename: 'po.pdf', mimeType: 'application/pdf' });
    expect(res.sha256).toBe(crypto.createHash('sha256').update(PDF).digest('hex'));
  });

  it('reads back byte-identical content', async () => {
    const res = await store.put(PNG, { filename: 'da-photo.png', mimeType: 'image/png' });
    const back = await store.get(res.storageKey, res.driver);
    expect(back.equals(PNG)).toBe(true);
  });

  it('reports existence, then removal', async () => {
    const res = await store.put(PDF, { filename: 'po.pdf', mimeType: 'application/pdf' });

    expect(await store.exists(res.storageKey, res.driver)).toBe(true);
    expect(await store.remove(res.storageKey, res.driver)).toBe(true);
    expect(await store.exists(res.storageKey, res.driver)).toBe(false);
  });

  it('removing an absent file is false, not an error', async () => {
    expect(await store.remove(String(new mongoose.Types.ObjectId()), 'gridfs')).toBe(false);
  });

  it('reading an absent file raises NOT_FOUND', async () => {
    try {
      await store.get(String(new mongoose.Types.ObjectId()), 'gridfs');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err.code).toBe('NOT_FOUND');
    }
  });

  it('exists() is false for a malformed key rather than throwing', async () => {
    expect(await store.exists('not-an-objectid', 'gridfs')).toBe(false);
  });

  it('keeps the docType and uploader in GridFS metadata for later audit', async () => {
    const uploader = new mongoose.Types.ObjectId();
    const res = await store.put(PDF, {
      filename: 'po.pdf', mimeType: 'application/pdf', docType: 'po', uploadedBy: uploader,
    });

    const doc = await mongoose.connection.db.collection('attachments.files')
      .findOne({ _id: new mongoose.Types.ObjectId(res.storageKey) });
    expect(doc.metadata.docType).toBe('po');
    expect(String(doc.metadata.uploadedBy)).toBe(String(uploader));
  });

  it('two uploads of identical bytes get distinct keys but the same digest', async () => {
    const a = await store.put(PDF, { filename: 'po.pdf', mimeType: 'application/pdf' });
    const b = await store.put(PDF, { filename: 'po-copy.pdf', mimeType: 'application/pdf' });
    expect(a.storageKey).not.toBe(b.storageKey);
    expect(a.sha256).toBe(b.sha256);
  });

  it('refuses to store an invalid file at all', async () => {
    await expect(store.put(ELF, { filename: 'po.pdf', mimeType: 'application/pdf' }))
      .rejects.toThrow(/Executable/);
  });
});
