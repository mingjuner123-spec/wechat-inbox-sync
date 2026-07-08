const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  DEFAULT_FEISHU_OAUTH_SCOPES,
  buildFeishuAuthorizeUrl,
  buildFeishuOAuthTokenRequest,
  buildFeishuOAuthRefreshRequest,
  extractFeishuOpenApiUrlInfo,
  fetchFeishuOpenApiBlocksFromUrl,
  normalizeScopeList,
  normalizeFeishuOAuthTokenPayload,
} = require('../cloudfunctions/syncApi/feishu-oauth-core');

(async () => {
  const syncApiIndexSource = fs.readFileSync(
    path.join(__dirname, '..', 'cloudfunctions', 'syncApi', 'index.js'),
    'utf8',
  );
  assert.ok(
    syncApiIndexSource.includes("const FEISHU_OAUTH_STORE_COLLECTION = 'feishu_oauth_states';"),
    'Feishu OAuth state should not be stored in bind_codes',
  );
  assert.ok(
    syncApiIndexSource.includes("const FEISHU_OAUTH_LEGACY_STORE_COLLECTION = 'bind_codes';"),
    'Feishu OAuth callback should still read legacy state docs during migration',
  );
  assert.ok(
    syncApiIndexSource.includes("const LEGACY_SYNC_API_BASE = 'https://he02-d8gebzv050ed6c4ef-1428610652.ap-shanghai.app.tcloudbase.com/sync';"),
    'Feishu OAuth runtime should validate existing bind codes against the real production sync API',
  );
  assert.ok(
    syncApiIndexSource.includes('async function findLegacySyncOpenIdByToken'),
    'Feishu OAuth runtime should keep a legacy sync auth fallback for existing users',
  );
  assert.ok(
    syncApiIndexSource.includes('process.env.FEISHU_OAUTH_SCOPES || DEFAULT_FEISHU_OAUTH_SCOPES')
      && syncApiIndexSource.includes('DEFAULT_FEISHU_OAUTH_SCOPES,'),
    'Feishu OAuth runtime should merge required default scopes even when FEISHU_OAUTH_SCOPES is configured',
  );
  const syncApiCoreSource = fs.readFileSync(
    path.join(__dirname, '..', 'cloudfunctions', 'syncApi', 'sync-api-core.js'),
    'utf8',
  );
  assert.ok(
    syncApiCoreSource.includes("getHeader(headers, 'x-wechat-inbox-token')"),
    'Feishu OAuth runtime should accept the backup token header when CloudBase strips Authorization',
  );
  assert.ok(
    syncApiCoreSource.includes('function parseAuthToken'),
    'Feishu OAuth runtime should accept token from query/body when CloudBase strips headers',
  );
  assert.ok(
    syncApiCoreSource.includes('query.authToken') && syncApiCoreSource.includes('body.authToken'),
    'Feishu OAuth runtime should parse authToken from query and body',
  );

  const adminHandlerSource = fs.readFileSync(
    path.join(__dirname, '..', 'cloudfunctions', 'syncApi', 'admin-handler.js'),
    'utf8',
  );
  assert.ok(
    adminHandlerSource.includes('/bind-codes/cleanup-feishu-oauth-state'),
    'Admin API should keep a cleanup route for legacy Feishu OAuth state docs',
  );

  const authUrl = buildFeishuAuthorizeUrl({
    appId: 'cli_test_app',
    redirectUri: 'https://example.com/sync/feishu/oauth/callback',
    state: 'state-123',
    scopes: DEFAULT_FEISHU_OAUTH_SCOPES,
  });
  const parsedAuthUrl = new URL(authUrl);
  assert.strictEqual(parsedAuthUrl.origin + parsedAuthUrl.pathname, 'https://accounts.feishu.cn/open-apis/authen/v1/authorize');
  assert.strictEqual(parsedAuthUrl.searchParams.get('client_id'), 'cli_test_app');
  assert.strictEqual(parsedAuthUrl.searchParams.get('response_type'), 'code');
  assert.strictEqual(parsedAuthUrl.searchParams.get('redirect_uri'), 'https://example.com/sync/feishu/oauth/callback');
  assert.strictEqual(parsedAuthUrl.searchParams.get('state'), 'state-123');
  assert.ok(parsedAuthUrl.searchParams.get('scope').includes('offline_access'));
  assert.ok(parsedAuthUrl.searchParams.get('scope').includes('docx:document:readonly'));
  assert.ok(parsedAuthUrl.searchParams.get('scope').includes('docs:document.media:download'));
  assert.ok(parsedAuthUrl.searchParams.get('scope').includes('wiki:node:read'));
  assert.ok(parsedAuthUrl.searchParams.get('scope').includes('wiki:node:retrieve'));
  assert.ok(parsedAuthUrl.searchParams.get('scope').includes('wiki:wiki:readonly'));
  assert.deepStrictEqual(
    normalizeScopeList('offline_access,docx:document:readonly docs:document.media:download,wiki:node:read'),
    ['offline_access', 'docx:document:readonly', 'docs:document.media:download', 'wiki:node:read'],
  );

  assert.deepStrictEqual(buildFeishuOAuthTokenRequest({
    appId: 'cli_test_app',
    appSecret: 'secret',
    code: 'oauth-code',
    redirectUri: 'https://example.com/callback',
  }), {
    url: 'https://open.feishu.cn/open-apis/authen/v2/oauth/token',
    body: {
      grant_type: 'authorization_code',
      client_id: 'cli_test_app',
      client_secret: 'secret',
      code: 'oauth-code',
      redirect_uri: 'https://example.com/callback',
    },
  });

  assert.deepStrictEqual(buildFeishuOAuthRefreshRequest({
    appId: 'cli_test_app',
    appSecret: 'secret',
    refreshToken: 'refresh-token-1',
  }), {
    url: 'https://open.feishu.cn/open-apis/authen/v2/oauth/token',
    body: {
      grant_type: 'refresh_token',
      client_id: 'cli_test_app',
      client_secret: 'secret',
      refresh_token: 'refresh-token-1',
    },
  });

  assert.deepStrictEqual(normalizeFeishuOAuthTokenPayload({
    access_token: 'access-1',
    expires_in: 7200,
    refresh_token: 'refresh-1',
    refresh_token_expires_in: 604800,
    scope: 'offline_access docx:document:readonly',
  }, '2026-07-04T10:00:00.000Z'), {
    accessToken: 'access-1',
    accessTokenExpiresAt: '2026-07-04T12:00:00.000Z',
    refreshToken: 'refresh-1',
    refreshTokenExpiresAt: '2026-07-11T10:00:00.000Z',
    scope: 'offline_access docx:document:readonly',
  });

  assert.deepStrictEqual(
    extractFeishuOpenApiUrlInfo('https://example.feishu.cn/wiki/wikiToken123?from=copy'),
    {
      apiBase: 'https://open.feishu.cn/open-apis',
      kind: 'wiki',
      token: 'wikiToken123',
    },
  );

  const requests = [];
  const result = await fetchFeishuOpenApiBlocksFromUrl({
    url: 'https://example.feishu.cn/wiki/wikiToken123',
    accessToken: 'user-access-token',
    requestJson: async (request) => {
      requests.push(request);
      if (request.url === 'https://open.feishu.cn/open-apis/wiki/v2/spaces/get_node?token=wikiToken123') {
        return {
          status: 200,
          json: {
            code: 0,
            data: {
              node: {
                obj_token: 'docxToken123',
                obj_type: 'docx',
                title: 'Wiki title',
              },
            },
          },
        };
      }
      if (request.url === 'https://open.feishu.cn/open-apis/docx/v1/documents/docxToken123') {
        return {
          status: 200,
          json: {
            code: 0,
            data: {
              document: {
                title: 'Document title',
              },
            },
          },
        };
      }
      if (request.url === 'https://open.feishu.cn/open-apis/docx/v1/documents/docxToken123/blocks?page_size=500') {
        return {
          status: 200,
          json: {
            code: 0,
            data: {
              has_more: true,
              page_token: 'next-page',
              items: [{ block_id: 'b1' }],
            },
          },
        };
      }
      if (request.url === 'https://open.feishu.cn/open-apis/docx/v1/documents/docxToken123/blocks?page_size=500&page_token=next-page') {
        return {
          status: 200,
          json: {
            code: 0,
            data: {
              has_more: false,
              items: [{ block_id: 'b2' }],
            },
          },
        };
      }
      throw new Error(`unexpected request ${request.url}`);
    },
  });

  assert.deepStrictEqual(result, {
    title: 'Document title',
    documentId: 'docxToken123',
    blockCount: 2,
    blocks: [{ block_id: 'b1' }, { block_id: 'b2' }],
    imageTokenCount: 0,
    imageTmpDownloadUrls: {},
    imageDownloadError: '',
  });
  assert.deepStrictEqual(requests.map((item) => item.headers.Authorization), [
    'Bearer user-access-token',
    'Bearer user-access-token',
    'Bearer user-access-token',
    'Bearer user-access-token',
  ]);

  const imageRequests = [];
  const imageResult = await fetchFeishuOpenApiBlocksFromUrl({
    url: 'https://example.feishu.cn/docx/docxImageToken',
    accessToken: 'user-access-token',
    requestJson: async (request) => {
      imageRequests.push(request);
      if (request.url === 'https://open.feishu.cn/open-apis/docx/v1/documents/docxImageToken') {
        return {
          status: 200,
          json: {
            code: 0,
            data: { document: { title: 'Image doc' } },
          },
        };
      }
      if (request.url === 'https://open.feishu.cn/open-apis/docx/v1/documents/docxImageToken/blocks?page_size=500') {
        return {
          status: 200,
          json: {
            code: 0,
            data: {
              has_more: false,
              items: [
                { block_id: 'img1', block_type: 27, image: { token: 'boxcnImageToken1' } },
              ],
            },
          },
        };
      }
      if (request.url === 'https://open.feishu.cn/open-apis/drive/v1/medias/batch_get_tmp_download_url?file_tokens=boxcnImageToken1') {
        return {
          status: 200,
          json: {
            code: 0,
            data: {
              tmp_download_urls: [
                {
                  file_token: 'boxcnImageToken1',
                  tmp_download_url: 'https://internal-api-drive-stream.feishu.cn/tmp-image-1',
                },
              ],
            },
          },
        };
      }
      throw new Error(`unexpected image request ${request.url}`);
    },
  });
  assert.strictEqual(imageResult.imageTokenCount, 1);
  assert.deepStrictEqual(imageResult.imageTmpDownloadUrls, {
    boxcnImageToken1: 'https://internal-api-drive-stream.feishu.cn/tmp-image-1',
  });
  assert.ok(imageRequests.some((item) => item.url.includes('/drive/v1/medias/batch_get_tmp_download_url')));
})();
