'use strict';
const { validationResult } = require('express-validator');
const Product = require('../models/Product');
const { ok, created, notFound, unprocessable, paginated } = require('../utils/response');

/* ── GET /api/products ───────────────────────────────────────────── */

async function listProducts(req, res, next) {
  try {
    const { category, isActive, q, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (category)             filter.category = category;
    if (isActive !== undefined) filter.isActive = isActive === 'true';
    if (q)                    filter.$text = { $search: q };

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [products, total] = await Promise.all([
      Product.find(filter).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)).lean(),
      Product.countDocuments(filter),
    ]);
    return paginated(res, products, total, parseInt(page), parseInt(limit));
  } catch (err) {
    next(err);
  }
}

/* ── GET /api/products/:id ───────────────────────────────────────── */

async function getProduct(req, res, next) {
  try {
    const product = await Product.findById(req.params.id).lean();
    if (!product) return notFound(res, 'Product not found');
    return ok(res, product);
  } catch (err) {
    next(err);
  }
}

/* ── POST /api/products ──────────────────────────────────────────── */

async function createProduct(req, res, next) {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return unprocessable(res, 'Validation failed', errors.array());

    const product = await Product.create({ ...req.body, createdBy: req.user._id });
    return created(res, product, 'Product created');
  } catch (err) {
    next(err);
  }
}

/* ── PUT /api/products/:id ───────────────────────────────────────── */

async function updateProduct(req, res, next) {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return unprocessable(res, 'Validation failed', errors.array());

    const product = await Product.findByIdAndUpdate(req.params.id, req.body, {
      new: true, runValidators: true,
    });
    if (!product) return notFound(res, 'Product not found');
    return ok(res, product, 'Product updated');
  } catch (err) {
    next(err);
  }
}

/* ── DELETE /api/products/:id ────────────────────────────────────── */

async function deleteProduct(req, res, next) {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return notFound(res, 'Product not found');

    /* Soft-delete */
    product.isActive = false;
    await product.save();
    return ok(res, {}, 'Product deactivated');
  } catch (err) {
    next(err);
  }
}

module.exports = { listProducts, getProduct, createProduct, updateProduct, deleteProduct };
