'use strict';
/**
 * fileStore — N-6, assumption A25.
 *
 * The three processes gate on uploaded documents: a PO before Commercial Order,
 * a signed DA plus a photo before Delivered, a Handover Certificate before
 * Handed Over. Those gates are worthless if the bytes are not reliably there.
 *
 * ── Why GridFS is the default ────────────────────────────────────────────
 * The app deploys to BOTH Vercel (ephemeral filesystem — anything written to
 * disk is gone on the next cold start) and on-prem Docker. GridFS rides the
 * Mongo connection that already exists, so one code path behaves identically on
 * both targets and no new infrastructure appears.
 *
 * A `local` driver exists for on-prem installs that want files on a mountable
 * disk for backup. It REFUSES TO START under Vercel rather than silently
 * writing to /tmp and losing a signed Delivery Acknowledgement — a document
 * that, per the framework, is a mandatory contractual record.
 *
 * ── What is validated ────────────────────────────────────────────────────
 * Size, declared MIME type, AND the leading magic bytes. A caller can claim any
 * Content-Type it likes; the sniff is what decides. Executables are refused
 * outright — nothing in this system has a reason to accept one.
 */
const crypto   = require('crypto');
const path     = require('path');
const fs       = require('fs');
const fsp      = require('fs/promises');
const mongoose = require('mongoose');

const BUCKET_NAME  = 'attachments';
const MAX_BYTES    = parseInt(process.env.UPLOAD_MAX_BYTES, 10) || 15 * 1024 * 1024; // 15 MB

/**
 * Allowed types, each with the magic-byte prefixes that prove it.
 * `null` means "no reliable signature" — plain text and CSV have none, so those
 * are accepted on declared type plus a control-character scan instead.
 */
const ALLOWED = {
  'application/pdf':  [Buffer.from('%PDF-')],
  'image/jpeg':       [Buffer.from([0xff, 0xd8, 0xff])],
  'image/png':        [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
  'image/webp':       [Buffer.from('RIFF')], // 'WEBP' at offset 8, checked below
  'image/heic':       [Buffer.from('ftyp'), Buffer.from('ftypheic')], // at offset 4
  /* Office formats are ZIP containers. */
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [Buffer.from([0x50, 0x4b, 0x03, 0x04])],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [Buffer.from([0x50, 0x4b, 0x03, 0x04])],
  'text/csv':         null,
  'text/plain':       null,
};

/** Refused regardless of declared type — checked against the sniffed bytes. */
const EXECUTABLE_SIGNATURES = [
  { label: 'ELF binary',      bytes: Buffer.from([0x7f, 0x45, 0x4c, 0x46]) },
  { label: 'Windows PE/DOS',  bytes: Buffer.from('MZ') },
  { label: 'Mach-O',          bytes: Buffer.from([0xcf, 0xfa, 0xed, 0xfe]) },
  { label: 'Mach-O (32-bit)', bytes: Buffer.from([0xce, 0xfa, 0xed, 0xfe]) },
  { label: 'Java class',      bytes: Buffer.from([0xca, 0xfe, 0xba, 0xbe]) },
  { label: 'shell script',    bytes: Buffer.from('#!') },
];

class FileStoreError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'FileStoreError';
    this.code = code;
    this.statusCode = 422;
  }
}

/* ── validation ───────────────────────────────────────────────────────── */

function startsWith(buf, sig, offset = 0) {
  if (buf.length < offset + sig.length) return false;
  return buf.subarray(offset, offset + sig.length).equals(sig);
}

function looksExecutable(buf) {
  for (const { label, bytes } of EXECUTABLE_SIGNATURES) {
    if (startsWith(buf, bytes)) return label;
  }
  return null;
}

function signatureMatches(mimeType, buf) {
  const sigs = ALLOWED[mimeType];

  /* No signature to check — accept only if the content is plausibly text.
     A NUL byte in the first block means it is not. */
  if (sigs === null) {
    return !buf.subarray(0, 512).includes(0x00);
  }

  if (mimeType === 'image/webp') {
    return startsWith(buf, Buffer.from('RIFF')) && startsWith(buf, Buffer.from('WEBP'), 8);
  }
  if (mimeType === 'image/heic') {
    return startsWith(buf, Buffer.from('ftyp'), 4);
  }
  return sigs.some((s) => startsWith(buf, s));
}

/**
 * Throws FileStoreError unless the buffer is an acceptable upload.
 * @param {Buffer} buffer
 * @param {{mimeType:string, filename:string, maxBytes?:number}} meta
 */
function validate(buffer, meta) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new FileStoreError('File is empty', 'EMPTY_FILE');
  }

  const maxBytes = meta.maxBytes || MAX_BYTES;
  if (buffer.length > maxBytes) {
    throw new FileStoreError(
      `File is ${Math.ceil(buffer.length / 1024)} KB — the limit is ${Math.floor(maxBytes / 1024)} KB`,
      'FILE_TOO_LARGE');
  }

  const exe = looksExecutable(buffer);
  if (exe) {
    throw new FileStoreError(`Executable files are not accepted (detected: ${exe})`, 'EXECUTABLE_REJECTED');
  }

  const mimeType = String(meta.mimeType || '').toLowerCase().split(';')[0].trim();
  if (!(mimeType in ALLOWED)) {
    throw new FileStoreError(`File type "${mimeType || 'unknown'}" is not accepted`, 'MIME_NOT_ALLOWED');
  }

  /* The declared type is a claim; the bytes are the evidence. */
  if (!signatureMatches(mimeType, buffer)) {
    throw new FileStoreError(
      `File content does not match its declared type "${mimeType}"`, 'CONTENT_MISMATCH');
  }

  return { mimeType, sizeBytes: buffer.length };
}

/* ── virus-scan hook ──────────────────────────────────────────────────────
   No scanner ships with this app. The hook exists so that wiring one in later
   is a registration, not a refactor of every upload path. */
let _scanner = null;
/** @param {null|function(Buffer, object): Promise<{clean:boolean, reason?:string}>} fn */
function setScanner(fn) { _scanner = fn; }

async function scan(buffer, meta) {
  if (!_scanner) return;
  const verdict = await _scanner(buffer, meta);
  if (verdict && verdict.clean === false) {
    throw new FileStoreError(
      `File rejected by virus scan${verdict.reason ? `: ${verdict.reason}` : ''}`, 'VIRUS_DETECTED');
  }
}

/* ── drivers ──────────────────────────────────────────────────────────── */

function bucket() {
  if (mongoose.connection.readyState !== 1) {
    throw new FileStoreError('Database connection is not ready', 'DB_NOT_READY');
  }
  return new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: BUCKET_NAME });
}

/* The driver has phrased this several ways across versions — the legacy
   `FileNotFound` code and, currently, a MongoRuntimeError reading
   "File not found for id <x>". Match both rather than one spelling. */
function isNotFoundError(err) {
  return !!err && /file\s*not\s*found/i.test(err.message || '');
}

const gridfsDriver = {
  name: 'gridfs',

  async put(buffer, meta) {
    const b = bucket();
    return new Promise((resolve, reject) => {
      const stream = b.openUploadStream(meta.filename, {
        contentType: meta.mimeType,
        metadata: {
          docType: meta.docType || null,
          uploadedBy: meta.uploadedBy || null,
          sha256: meta.sha256,
        },
      });
      stream.on('error', reject);
      stream.on('finish', () => resolve(String(stream.id)));
      stream.end(buffer);
    });
  },

  async get(storageKey) {
    const b = bucket();
    const _id = new mongoose.Types.ObjectId(storageKey);
    return new Promise((resolve, reject) => {
      const chunks = [];
      b.openDownloadStream(_id)
        .on('data', (c) => chunks.push(c))
        .on('error', (err) => reject(
          isNotFoundError(err) ? new FileStoreError('File not found', 'NOT_FOUND') : err))
        .on('end', () => resolve(Buffer.concat(chunks)));
    });
  },

  async remove(storageKey) {
    try {
      await bucket().delete(new mongoose.Types.ObjectId(storageKey));
      return true;
    } catch (err) {
      if (isNotFoundError(err)) return false;
      throw err;
    }
  },

  async exists(storageKey) {
    let _id;
    try { _id = new mongoose.Types.ObjectId(storageKey); } catch { return false; }
    const found = await bucket().find({ _id }).limit(1).toArray();
    return found.length > 0;
  },
};

const localDriver = {
  name: 'local',

  get root() {
    return process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
  },

  _path(storageKey) {
    /* storageKey is generated here, never caller-supplied, but resolve and
       re-check anyway — a traversal bug in a future caller should not become a
       filesystem write outside the root. */
    const full = path.resolve(this.root, storageKey);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) {
      throw new FileStoreError('Invalid storage key', 'INVALID_KEY');
    }
    return full;
  },

  async put(buffer, meta) {
    const key = `${new mongoose.Types.ObjectId()}${path.extname(meta.filename) || ''}`;
    const full = this._path(key);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    await fsp.writeFile(full, buffer);
    return key;
  },

  async get(storageKey) {
    try {
      return await fsp.readFile(this._path(storageKey));
    } catch (err) {
      if (err.code === 'ENOENT') throw new FileStoreError('File not found', 'NOT_FOUND');
      throw err;
    }
  },

  async remove(storageKey) {
    try {
      await fsp.unlink(this._path(storageKey));
      return true;
    } catch (err) {
      if (err.code === 'ENOENT') return false;
      throw err;
    }
  },

  async exists(storageKey) {
    try { return fs.existsSync(this._path(storageKey)); } catch { return false; }
  },
};

const DRIVERS = { gridfs: gridfsDriver, local: localDriver };

/**
 * Resolve the configured driver.
 *
 * The Vercel guard is the point of this function: `local` on a serverless
 * platform writes to a filesystem that vanishes, and the failure mode is a
 * Work Order that cannot be closed because its signed DA is gone. Failing at
 * startup is much cheaper than discovering that later.
 */
function driver() {
  const name = (process.env.FILE_STORE_DRIVER || 'gridfs').toLowerCase();
  const d = DRIVERS[name];
  if (!d) {
    throw new FileStoreError(
      `Unknown FILE_STORE_DRIVER "${name}" — expected one of: ${Object.keys(DRIVERS).join(', ')}`,
      'UNKNOWN_DRIVER');
  }
  if (name === 'local' && process.env.VERCEL) {
    throw new FileStoreError(
      'FILE_STORE_DRIVER=local cannot be used on Vercel: the filesystem is ephemeral and '
      + 'uploaded documents would be lost on the next cold start. Use the default gridfs driver.',
      'LOCAL_DRIVER_ON_SERVERLESS');
  }
  return d;
}

/* ── public API ───────────────────────────────────────────────────────── */

/**
 * Validate, scan and store a file.
 * @returns {Promise<{driver, storageKey, sha256, sizeBytes, mimeType, filename}>}
 *          — exactly the fields AttachmentSchema requires.
 */
async function put(buffer, meta = {}) {
  const { mimeType, sizeBytes } = validate(buffer, meta);
  await scan(buffer, meta);

  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const d = driver();
  const storageKey = await d.put(buffer, { ...meta, mimeType, sha256 });

  return {
    driver: d.name,
    storageKey,
    sha256,
    sizeBytes,
    mimeType,
    filename: meta.filename,
  };
}

/** Read a file back. `driverName` comes off the stored attachment. */
async function get(storageKey, driverName) {
  const d = driverName ? DRIVERS[driverName] : driver();
  if (!d) throw new FileStoreError(`Unknown driver "${driverName}"`, 'UNKNOWN_DRIVER');
  return d.get(storageKey);
}

async function remove(storageKey, driverName) {
  const d = driverName ? DRIVERS[driverName] : driver();
  if (!d) throw new FileStoreError(`Unknown driver "${driverName}"`, 'UNKNOWN_DRIVER');
  return d.remove(storageKey);
}

async function exists(storageKey, driverName) {
  const d = driverName ? DRIVERS[driverName] : driver();
  if (!d) return false;
  return d.exists(storageKey);
}

module.exports = {
  put, get, remove, exists,
  validate, driver, setScanner,
  FileStoreError,
  ALLOWED_MIME_TYPES: Object.keys(ALLOWED),
  MAX_BYTES, BUCKET_NAME,
};
