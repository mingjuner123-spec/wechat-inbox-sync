'use strict';

function isCloudTranscriptionWaitingRecord(record) {
  const metadata = (record && record.metadata) || {};
  const status = String(metadata.transcriptionStatus || '').toLowerCase();
  const source = String(metadata.transcriptionSource || metadata.transcriptionProvider || '').toLowerCase();
  const isCloudRecord = metadata.transcriptionMode === 'cloud'
    || metadata.cloudTranscriptionRequested === true
    || source.includes('cloud-pretranscription')
    || source.includes('cloud');
  const hasTranscription = String(metadata.transcription || '').trim().length > 0;
  return isCloudRecord && !hasTranscription && ['pending', 'queued', 'processing'].includes(status);
}

function isAudioVideoTranscriptionIncompleteRecord(record) {
  const metadata = (record && record.metadata) || {};
  const status = String(metadata.transcriptionStatus || '').toLowerCase();
  const hasTranscription = String(metadata.transcription || '').trim().length > 0;
  const hasPersistableMarkdown = String(metadata.markdown || metadata.snapshot || metadata.contentSnapshot || '').trim().length > 0;
  if (hasPersistableMarkdown) return false;
  const isAudioVideoRecord = String(record && record.type || '').toLowerCase() === 'voice'
    || metadata.webpageMediaType === 'audio_video'
    || Boolean(metadata.audioFileID)
    || metadata.transcriptOnly === true;
  if (!isAudioVideoRecord || hasTranscription) return false;
  return ['pending', 'queued', 'processing', 'failed'].includes(status);
}

module.exports = {
  isAudioVideoTranscriptionIncompleteRecord,
  isCloudTranscriptionWaitingRecord,
};
