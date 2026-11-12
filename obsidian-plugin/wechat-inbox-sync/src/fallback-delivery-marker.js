'use strict';

const crypto = require('node:crypto');

// A record can have an attachment-only note or an older successful attempt.
// Neither proves that this particular fallback result has been committed.
function fallbackDeliveryId(record) {
  const metadata = record && record.metadata || {};
  const recordId = String(record && (record._id || record.id || record.recordId) || '').trim();
  const jobId = String(metadata.cloudFallbackJobId || '').trim();
  if (!recordId || !jobId || metadata.cloudFallbackStatus !== 'succeeded') return '';
  return crypto.createHash('sha256').update(JSON.stringify([
    recordId, jobId, String(metadata.cloudFallbackDeliveryKey || ''),
  ])).digest('hex');
}

function fallbackDeliveryMarker(record) {
  const digest = fallbackDeliveryId(record);
  return digest ? `<!-- wechat-inbox-fallback-delivery: ${digest} -->` : '';
}

function hasFallbackDeliveryMarker(markdown, record) {
  const marker = fallbackDeliveryMarker(record);
  return Boolean(marker && String(markdown || '').split(/\r?\n/).some(line => line.trim() === marker));
}

function markFallbackDelivery(markdown, record) {
  const marker = fallbackDeliveryMarker(record);
  if (!marker || hasFallbackDeliveryMarker(markdown, record)) return markdown;
  return `${String(markdown || '').trimEnd()}\n\n${marker}\n`;
}

module.exports = { fallbackDeliveryId, fallbackDeliveryMarker, hasFallbackDeliveryMarker, markFallbackDelivery };
