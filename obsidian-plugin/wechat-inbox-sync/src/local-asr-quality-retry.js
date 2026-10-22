'use strict';

function shouldRetryLocalAsrQualityFailure({ enabled, aborted, error, platform, managed, cpu, attemptCount } = {}) {
  return Boolean(error
    && enabled === true
    && aborted !== true
    && error.code === 'TRANSCRIPTION_LOW_QUALITY'
    && platform === 'darwin'
    && managed === true
    && cpu !== true
    && Number(attemptCount) < 2);
}

async function runLocalAsrWithQualityRetry({
  enabled,
  platform,
  managed,
  primaryCpu,
  isAborted = () => false,
  getAttemptCount = () => 1,
  run,
  validate,
  onRetry = () => {},
  onQualityRejected = () => {},
} = {}) {
  let execution = await run(Boolean(primaryCpu), 0);
  try {
    return { execution, transcription: validate(execution), qualityRetried: false };
  } catch (error) {
    if (error && error.code === 'TRANSCRIPTION_LOW_QUALITY') onQualityRejected(error, execution);
    if (!shouldRetryLocalAsrQualityFailure({
      enabled,
      aborted: isAborted(),
      error,
      platform,
      managed,
      cpu: execution && execution.cpu,
      attemptCount: getAttemptCount(),
    })) throw error;
    onRetry(error);
    if (isAborted()) {
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      throw abortError;
    }
    execution = await run(true, getAttemptCount());
    try {
      return { execution, transcription: validate(execution), qualityRetried: true };
    } catch (retryError) {
      if (retryError && retryError.code === 'TRANSCRIPTION_LOW_QUALITY') onQualityRejected(retryError, execution);
      throw retryError;
    }
  }
}

module.exports = { runLocalAsrWithQualityRetry, shouldRetryLocalAsrQualityFailure };
