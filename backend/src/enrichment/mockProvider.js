'use strict';

/* PRD 5 — Mock enrichment provider.
   Generates plausible data from the company name / email domain so the
   full enrichment UX can be built and tested without a real vendor contract.
   Swap for Clearbit / Apollo by adding a new file here and updating index.js. */

const INDUSTRIES = [
  'Real Estate', 'Financial Services', 'Information Technology',
  'Manufacturing', 'Healthcare', 'Retail', 'Construction',
  'Education', 'Logistics & Supply Chain', 'Hospitality',
];

const EMPLOYEE_BANDS = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1000+'];

const COUNTRIES = ['India', 'UAE', 'Singapore', 'USA', 'UK'];

/* Deterministic-ish seed from a string so the same company always gets
   the same "enrichment" — avoids flickering in the UI during dev. */
function seed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h;
}

function pick(arr, n) { return arr[n % arr.length]; }

function domainFromEmail(email) {
  if (!email) return null;
  const parts = email.split('@');
  if (parts.length < 2) return null;
  const domain = parts[1].toLowerCase();
  const personal = ['gmail.com','yahoo.com','hotmail.com','outlook.com','icloud.com','rediffmail.com'];
  return personal.includes(domain) ? null : domain;
}

async function enrich({ name, email, company }) {
  /* Simulate network latency (50–300 ms) */
  await new Promise(r => setTimeout(r, 50 + Math.random() * 250));

  const domain = domainFromEmail(email);
  const anchor = domain || (company || name || '').toLowerCase().replace(/\s+/g, '');
  if (!anchor) return null;

  const n = seed(anchor);

  const companyName = company || (domain ? domain.split('.')[0].replace(/-/g, ' ') : name);
  const slug = companyName.toLowerCase().replace(/[^a-z0-9]/g, '');

  return {
    website:       domain ? `https://www.${domain}` : `https://www.${slug}.com`,
    industry:      pick(INDUSTRIES, n),
    employeeCount: pick(EMPLOYEE_BANDS, (n >> 4)),
    hqCountry:     pick(COUNTRIES, (n >> 8)),
    linkedinUrl:   `https://www.linkedin.com/company/${slug}`,
    logoUrl:       `https://logo.clearbit.com/${domain || slug + '.com'}`,
  };
}

module.exports = { enrich, name: 'mock_v1' };
