function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function assertRequired(value, name) {
  if (!value) {
    throw new Error(`${name} is required`);
  }
}

async function parseJsonResponse(response) {
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.errMsg || `HTTP ${response.status || 'request failed'}`);
  }
  if (payload.success === false) {
    throw new Error(payload.errMsg || 'Cloud API request failed');
  }
  return payload;
}

function createCloudClient({ baseUrl, token, fetchImpl = globalThis.fetch }) {
  assertRequired(baseUrl, 'Cloud API base URL');
  assertRequired(token, 'Cloud API token');
  assertRequired(fetchImpl, 'Fetch implementation');

  const apiBase = trimTrailingSlash(baseUrl);

  function authHeaders(extraHeaders = {}) {
    return {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...extraHeaders,
    };
  }

  async function listPendingRecords() {
    const response = await fetchImpl(`${apiBase}/records?status=pending`, {
      method: 'GET',
      headers: authHeaders(),
    });
    const payload = await parseJsonResponse(response);
    return payload.data || [];
  }

  async function markRecordSynced(recordId) {
    assertRequired(recordId, 'Record ID');
    const response = await fetchImpl(`${apiBase}/records/${encodeURIComponent(recordId)}/synced`, {
      method: 'POST',
      headers: authHeaders({
        'Content-Type': 'application/json',
      }),
      body: '{}',
    });
    const payload = await parseJsonResponse(response);
    return payload.data;
  }

  return {
    listPendingRecords,
    markRecordSynced,
  };
}

module.exports = {
  createCloudClient,
};

