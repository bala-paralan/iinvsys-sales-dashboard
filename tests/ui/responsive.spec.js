'use strict';
/**
 * Responsive UI tests for IINVSYS Sales Dashboard.
 * Covers: modals, bottom-sheet behaviour, form layout, sidebar toggle,
 * overflow, and button accessibility across 4 viewport sizes.
 *
 * Run:  npm test:ui                 (all viewports)
 *       npm run test:ui:mobile      (375px / 430px only)
 *       npm run test:ui:headed      (watch mode)
 */
const { test, expect } = require('@playwright/test');

/* ─── helpers ─────────────────────────────────────────────── */

/** Hide login page and expose the main app without real auth. */
async function bypassAuth(page) {
  await page.evaluate(() => {
    document.getElementById('loginPage').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    // Activate the overview page so content is rendered
    document.querySelectorAll('.page').forEach(p =>
      p.classList.toggle('active', p.id === 'page-overview')
    );
    document.querySelectorAll('.nav-item').forEach(n =>
      n.classList.toggle('active', n.dataset.page === 'overview')
    );
  });
}

/** Open a modal by adding the .open class via JS. */
async function openModal(page, modalId) {
  await page.evaluate(id => document.getElementById(id).classList.add('open'), modalId);
  await page.waitForTimeout(350); // let CSS transition complete
}

/** Close a modal. */
async function closeModal(page, modalId) {
  await page.evaluate(id => document.getElementById(id).classList.remove('open'), modalId);
  await page.waitForTimeout(200);
}

/** Return true when the viewport width is ≤ the given breakpoint. */
async function atBreakpoint(page, maxWidth) {
  return page.viewportSize().width <= maxWidth;
}

/* ─── shared setup ─────────────────────────────────────────── */

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await bypassAuth(page);
});

/* ═══════════════════════════════════════════════════════════
   1. NO HORIZONTAL OVERFLOW — page & modals
═══════════════════════════════════════════════════════════ */

test.describe('No horizontal overflow', () => {
  test('Page body has no horizontal scrollbar', async ({ page }) => {
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  for (const modalId of ['leadModal', 'bulkImportModal', 'productModal', 'agentModal', 'confirmModal', 'infoModal']) {
    test(`${modalId}: no horizontal overflow when open`, async ({ page }) => {
      // Give infoModal some content so it renders properly
      if (modalId === 'infoModal') {
        await page.evaluate(() => {
          document.getElementById('infoModalTitle').textContent = 'Test Preview';
          document.getElementById('infoModalBody').innerHTML = '<p>Sample content for layout test.</p>';
        });
      }

      await openModal(page, modalId);

      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflow).toBeLessThanOrEqual(1);

      await closeModal(page, modalId);
    });
  }
});

/* ═══════════════════════════════════════════════════════════
   2. MODAL BOX FITS WITHIN VIEWPORT
═══════════════════════════════════════════════════════════ */

test.describe('Modal box fits viewport', () => {
  const modals = [
    'leadModal',
    'bulkImportModal',
    'productModal',
    'agentModal',
    'confirmModal',
    'infoModal',
  ];

  for (const modalId of modals) {
    test(`${modalId}: box stays within viewport bounds`, async ({ page }) => {
      if (modalId === 'infoModal') {
        await page.evaluate(() => {
          document.getElementById('infoModalTitle').textContent = 'Preview';
          document.getElementById('infoModalBody').innerHTML = '<p>Content</p>';
        });
      }

      await openModal(page, modalId);

      const vp = page.viewportSize();
      const box = await page.locator(`#${modalId} .modal-box`).boundingBox();

      expect(box).not.toBeNull();
      // Left edge must be on-screen
      expect(box.x).toBeGreaterThanOrEqual(-1);
      // Right edge must not exceed viewport
      expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 1);
      // Bottom edge must not exceed viewport (modals are scrollable)
      expect(box.y + box.height).toBeLessThanOrEqual(vp.height + 2);

      await closeModal(page, modalId);
    });
  }
});

/* ═══════════════════════════════════════════════════════════
   3. MODAL WIDTH IS RESPONSIVE
═══════════════════════════════════════════════════════════ */

test.describe('Modal width is responsive', () => {
  test('Lead modal width ≤ viewport width', async ({ page }) => {
    await openModal(page, 'leadModal');
    const vp = page.viewportSize();
    const box = await page.locator('#leadModal .modal-box').boundingBox();
    expect(box.width).toBeLessThanOrEqual(vp.width);
    await closeModal(page, 'leadModal');
  });

  test('Wide modals (bulkImport, infoModal) do not exceed viewport', async ({ page }) => {
    await page.evaluate(() => {
      document.getElementById('infoModalTitle').textContent = 'Wide Modal Test';
      document.getElementById('infoModalBody').innerHTML = '<p>Wide content</p>';
    });

    for (const id of ['bulkImportModal', 'infoModal']) {
      await openModal(page, id);
      const vp = page.viewportSize();
      const box = await page.locator(`#${id} .modal-box`).boundingBox();
      expect(box.width).toBeLessThanOrEqual(vp.width);
      await closeModal(page, id);
    }
  });

  test('On mobile (≤480px): modal is full-width bottom sheet', async ({ page }) => {
    const vp = page.viewportSize();
    if (vp.width > 480) test.skip();

    await openModal(page, 'leadModal');
    const box = await page.locator('#leadModal .modal-box').boundingBox();
    // Full-width: box width should equal viewport width
    expect(box.width).toBeCloseTo(vp.width, 0);
    // Bottom sheet: anchored to bottom of viewport
    expect(box.y + box.height).toBeCloseTo(vp.height, 5);
    await closeModal(page, 'leadModal');
  });
});

/* ═══════════════════════════════════════════════════════════
   4. FORM LAYOUT — SINGLE COLUMN ON MOBILE / TABLET
═══════════════════════════════════════════════════════════ */

test.describe('Form rows collapse to single column on small viewports', () => {
  test('Lead modal: form-rows are single column at ≤900px', async ({ page }) => {
    const vp = page.viewportSize();
    if (vp.width > 900) test.skip();

    await openModal(page, 'leadModal');

    const rows = await page.locator('#leadModal .form-row').all();
    for (const row of rows) {
      const groups = await row.locator('.form-group').all();
      if (groups.length < 2) continue;

      const b1 = await groups[0].boundingBox();
      const b2 = await groups[1].boundingBox();
      // In single-column layout the second group must be below the first
      expect(b2.y).toBeGreaterThan(b1.y + b1.height * 0.5);
    }

    await closeModal(page, 'leadModal');
  });

  test('Agent modal: form-rows are single column at ≤900px', async ({ page }) => {
    const vp = page.viewportSize();
    if (vp.width > 900) test.skip();

    await openModal(page, 'agentModal');

    const rows = await page.locator('#agentModal .form-row').all();
    for (const row of rows) {
      const groups = await row.locator('.form-group').all();
      if (groups.length < 2) continue;

      const b1 = await groups[0].boundingBox();
      const b2 = await groups[1].boundingBox();
      expect(b2.y).toBeGreaterThan(b1.y + b1.height * 0.5);
    }

    await closeModal(page, 'agentModal');
  });
});

/* ═══════════════════════════════════════════════════════════
   5. FORM ACTIONS — BUTTONS STACK ON SMALL MOBILE
═══════════════════════════════════════════════════════════ */

test.describe('Form action buttons stack vertically on ≤480px', () => {
  test('Lead modal: action buttons are stacked', async ({ page }) => {
    const vp = page.viewportSize();
    if (vp.width > 480) test.skip();

    await openModal(page, 'leadModal');

    const btns = await page.locator('#leadModal .form-actions .neo-btn').all();
    if (btns.length < 2) return;

    const b1 = await btns[0].boundingBox();
    const b2 = await btns[1].boundingBox();
    // Stacked = they should not share the same Y row
    expect(Math.abs(b1.y - b2.y)).toBeGreaterThan(20);

    await closeModal(page, 'leadModal');
  });

  test('Product modal: action buttons are stacked', async ({ page }) => {
    const vp = page.viewportSize();
    if (vp.width > 480) test.skip();

    await openModal(page, 'productModal');

    const btns = await page.locator('#productModal .form-actions .neo-btn').all();
    if (btns.length < 2) return;

    const b1 = await btns[0].boundingBox();
    const b2 = await btns[1].boundingBox();
    expect(Math.abs(b1.y - b2.y)).toBeGreaterThan(20);

    await closeModal(page, 'productModal');
  });

  test('Confirm modal: action buttons remain side-by-side on ≤480px', async ({ page }) => {
    const vp = page.viewportSize();
    if (vp.width > 480) test.skip();

    await openModal(page, 'confirmModal');

    const btns = await page.locator('#confirmModal .form-actions .neo-btn').all();
    if (btns.length < 2) return;

    const b1 = await btns[0].boundingBox();
    const b2 = await btns[1].boundingBox();
    // Side-by-side = same Y row
    expect(Math.abs(b1.y - b2.y)).toBeLessThan(20);

    await closeModal(page, 'confirmModal');
  });
});

/* ═══════════════════════════════════════════════════════════
   6. CLOSE BUTTON IS ALWAYS ACCESSIBLE
═══════════════════════════════════════════════════════════ */

test.describe('Close buttons are accessible on all viewports', () => {
  const closeMap = {
    leadModal:       '#leadModalClose',
    bulkImportModal: '#bulkImportClose',
    productModal:    '#productModalClose',
    agentModal:      '#agentModalClose',
    infoModal:       '#infoModalClose',
  };

  for (const [modalId, closeSelector] of Object.entries(closeMap)) {
    test(`${modalId}: close button is in viewport`, async ({ page }) => {
      if (modalId === 'infoModal') {
        await page.evaluate(() => {
          document.getElementById('infoModalTitle').textContent = 'Test';
          document.getElementById('infoModalBody').innerHTML = '<p>Content</p>';
        });
      }

      await openModal(page, modalId);

      const vp = page.viewportSize();
      const btn = page.locator(closeSelector);
      const count = await btn.count();
      if (count === 0) return; // skip if close button ID not present

      const box = await btn.boundingBox();
      expect(box).not.toBeNull();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 1);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(vp.height + 2);

      await closeModal(page, modalId);
    });
  }

  test('Confirm modal: Cancel button closes the dialog', async ({ page }) => {
    await openModal(page, 'confirmModal');
    await page.locator('#confirmCancel').click();
    await page.waitForTimeout(300);
    await expect(page.locator('#confirmModal')).not.toHaveClass(/\bopen\b/);
  });
});

/* ═══════════════════════════════════════════════════════════
   7. SIDEBAR RESPONSIVENESS
═══════════════════════════════════════════════════════════ */

test.describe('Sidebar behaviour on mobile', () => {
  test('Sidebar is hidden by default at ≤900px', async ({ page }) => {
    const vp = page.viewportSize();
    if (vp.width > 900) test.skip();

    const sidebar = page.locator('.sidebar');
    // Should NOT have the .open class on load
    const classes = await sidebar.getAttribute('class');
    expect(classes).not.toMatch(/\bopen\b/);

    // Sidebar transform should move it off-screen
    const transform = await sidebar.evaluate(el =>
      getComputedStyle(el).transform
    );
    // translateX(-100%) → matrix(-1, ...) or contains negative X
    expect(transform).not.toBe('none');
  });

  test('Mobile nav toggle opens and closes sidebar', async ({ page }) => {
    const vp = page.viewportSize();
    if (vp.width > 900) test.skip();

    const toggle = page.locator('#mobileToggle');
    const sidebar = page.locator('.sidebar');

    await toggle.click();
    await expect(sidebar).toHaveClass(/\bopen\b/);

    await toggle.click();
    await expect(sidebar).not.toHaveClass(/\bopen\b/);
  });

  test('Mobile nav toggle button is visible at ≤900px', async ({ page }) => {
    const vp = page.viewportSize();
    if (vp.width > 900) test.skip();

    const toggle = page.locator('#mobileToggle');
    await expect(toggle).toBeVisible();
  });

  test('Mobile nav toggle is hidden at desktop widths', async ({ page }) => {
    const vp = page.viewportSize();
    if (vp.width <= 900) test.skip();

    const display = await page.locator('#mobileToggle').evaluate(el =>
      getComputedStyle(el).display
    );
    expect(display).toBe('none');
  });
});

/* ═══════════════════════════════════════════════════════════
   8. MODAL MAX-HEIGHT + SCROLL (tall content)
═══════════════════════════════════════════════════════════ */

test.describe('Modal scrolls when content is taller than viewport', () => {
  test('Lead modal: box height does not exceed viewport', async ({ page }) => {
    await openModal(page, 'leadModal');

    const vp = page.viewportSize();
    const box = await page.locator('#leadModal .modal-box').boundingBox();
    expect(box.height).toBeLessThanOrEqual(vp.height + 2);

    await closeModal(page, 'leadModal');
  });

  test('Info modal: tall content is scrollable, not clipped', async ({ page }) => {
    await page.evaluate(() => {
      document.getElementById('infoModalTitle').textContent = 'Tall Modal';
      document.getElementById('infoModalBody').innerHTML =
        Array(40).fill('<p style="margin:0;padding:8px 0">Line of content</p>').join('');
    });

    await openModal(page, 'infoModal');

    const vp = page.viewportSize();
    const box = await page.locator('#infoModal .modal-box').boundingBox();

    // Must not overflow viewport
    expect(box.height).toBeLessThanOrEqual(vp.height + 2);

    // Must be scrollable (scrollHeight > clientHeight)
    const isScrollable = await page.locator('#infoModal .modal-box').evaluate(el =>
      el.scrollHeight > el.clientHeight
    );
    expect(isScrollable).toBe(true);

    await closeModal(page, 'infoModal');
  });
});

/* ═══════════════════════════════════════════════════════════
   9. SETTINGS PAGE LAYOUT
═══════════════════════════════════════════════════════════ */

test.describe('Settings page responsive layout', () => {
  test.beforeEach(async ({ page }) => {
    await page.evaluate(() => {
      document.querySelectorAll('.page').forEach(p =>
        p.classList.toggle('active', p.id === 'page-settings')
      );
    });
  });

  test('Settings rows stack at ≤900px', async ({ page }) => {
    const vp = page.viewportSize();
    if (vp.width > 900) test.skip();

    const rows = await page.locator('.settings-row').all();
    if (rows.length === 0) return;

    for (const row of rows) {
      const children = await row.locator(':scope > *').all();
      if (children.length < 2) continue;

      const c1 = await children[0].boundingBox();
      const c2 = await children[1].boundingBox();
      if (!c1 || !c2) continue;

      // Stacked: second child should be below first
      expect(c2.y).toBeGreaterThanOrEqual(c1.y + c1.height * 0.5);
    }
  });

  test('Settings inputs do not overflow viewport at ≤480px', async ({ page }) => {
    const vp = page.viewportSize();
    if (vp.width > 480) test.skip();

    const inputs = await page.locator('.settings-input').all();
    for (const input of inputs) {
      const box = await input.boundingBox();
      if (!box) continue;
      expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 1);
    }
  });
});

/* ═══════════════════════════════════════════════════════════
   10. BULK IMPORT WIZARD STEPS — SCROLLABLE ON MOBILE
═══════════════════════════════════════════════════════════ */

test.describe('Bulk import wizard steps on small screens', () => {
  test('Wizard step bar does not overflow horizontally', async ({ page }) => {
    await openModal(page, 'bulkImportModal');

    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);

    const bar = page.locator('.wizard-steps');
    const count = await bar.count();
    if (count === 0) {
      await closeModal(page, 'bulkImportModal');
      return;
    }

    const vp = page.viewportSize();
    const box = await bar.boundingBox();
    expect(box.width).toBeLessThanOrEqual(vp.width + 1);

    await closeModal(page, 'bulkImportModal');
  });
});
