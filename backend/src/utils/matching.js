'use strict';

/* PRD 4 — phone normalization + fuzzy name match.
   Pure functions, no external deps. */

/* Normalize Indian-default phones to E.164.
   Accepts: "+91 98200 00000", "9820000000", "098200-00000", "0091-9820000000" */
function normalizePhone(raw, defaultCountry = '91') {
  if (!raw) return '';
  let digits = String(raw).replace(/[^\d+]/g, '');
  if (digits.startsWith('00')) digits = '+' + digits.slice(2);
  if (digits.startsWith('+')) return digits;
  /* Strip leading trunk-zero only if defaultCountry expects it (India does) */
  if (digits.startsWith('0')) digits = digits.slice(1);
  /* If the number already starts with the country code (e.g. 9198…), keep it */
  if (digits.length > 10 && digits.startsWith(defaultCountry)) return '+' + digits;
  return '+' + defaultCountry + digits;
}

/* Jaro similarity */
function jaro(a, b) {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const matchDistance = Math.floor(Math.max(a.length, b.length) / 2) - 1;
  const aMatches = new Array(a.length).fill(false);
  const bMatches = new Array(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, b.length);
    for (let j = start; j < end; j++) {
      if (bMatches[j]) continue;
      if (a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  return ((matches / a.length) + (matches / b.length) + ((matches - transpositions / 2) / matches)) / 3;
}

/* Jaro-Winkler with default 0.1 prefix scaling */
function jaroWinkler(a, b) {
  if (!a || !b) return 0;
  a = String(a).toLowerCase().trim();
  b = String(b).toLowerCase().trim();
  const j = jaro(a, b);
  let prefix = 0;
  for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
    if (a[i] === b[i]) prefix++; else break;
  }
  return j + prefix * 0.1 * (1 - j);
}

/* Combined name+company score: weighted blend, name dominant */
function nameCompanyScore({ aName, aCompany, bName, bCompany }) {
  const nameScore = jaroWinkler(aName || '', bName || '');
  const compScore = (aCompany && bCompany) ? jaroWinkler(aCompany, bCompany) : null;
  if (compScore === null) return nameScore;
  return nameScore * 0.7 + compScore * 0.3;
}

module.exports = { normalizePhone, jaro, jaroWinkler, nameCompanyScore };
