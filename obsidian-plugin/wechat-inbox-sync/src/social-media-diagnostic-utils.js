'use strict';

function createDouyinMediaResolutionDiagnosticBuilder(dependencies = {}) {
  const {
    getSafeUrlDiagnostic = () => ({ protocol: '', host: '' }),
    getTransportErrorDiagnostic = () => ({}),
  } = dependencies;

  return ({
    sourceUrl = '',
    resolvedUrl = '',
    awemeId = '',
    stages = [],
    mediaCandidateCount = 0,
    preciseMediaFound = false,
    saveOriginalMediaEnabled = false,
  } = {}) => ({
    source: getSafeUrlDiagnostic(sourceUrl),
    resolved: getSafeUrlDiagnostic(resolvedUrl),
    awemeId: String(awemeId || '').slice(0, 64),
    mediaCandidateCount: Number(mediaCandidateCount) || 0,
    preciseMediaFound: preciseMediaFound === true,
    saveOriginalMediaEnabled: saveOriginalMediaEnabled === true,
    stages: (Array.isArray(stages) ? stages : []).slice(-12).map((stage) => ({
      stage: String(stage && stage.stage || '').slice(0, 64),
      ok: stage && stage.ok !== false,
      mediaCount: Number(stage && stage.mediaCount) || 0,
      detailFound: stage && stage.detailFound === true,
      error: stage && stage.error ? getTransportErrorDiagnostic(stage.error) : undefined,
    })),
  });
}

module.exports = {
  createDouyinMediaResolutionDiagnosticBuilder,
};
