const ALLOWED_HOST_PATTERN = /\.aedev\.feishuapp\.cn$/;
const MAIN_PANEL_PATH = 'sidepanel/index.html';
const DISABLED_PANEL_PATH = 'sidepanel/not-available.html';
const AUTH_STORAGE_KEY = 'authInfo';

// 点击扩展图标时打开/关闭侧边栏
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('设置侧边栏行为失败:', error));

chrome.runtime.onInstalled.addListener(() => {
  console.log('aPaaS Tools 扩展已安装');
});

/**
 * 根据标签页 URL 动态设置侧边栏内容
 */
async function updateSidePanelForTab(tabId, url) {
  const host = url ? new URL(url).host : '';
  const isAllowed = ALLOWED_HOST_PATTERN.test(host);

  await chrome.sidePanel.setOptions({
    tabId,
    path: isAllowed ? MAIN_PANEL_PATH : DISABLED_PANEL_PATH,
    enabled: true,
  });
}

// 标签页切换时更新
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    await updateSidePanelForTab(tabId, tab.url);
  } catch (error) {
    console.error('切换标签页时更新侧边栏失败:', error);
  }
});

// 标签页 URL 变化时更新
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url && tab.active) {
    try {
      await updateSidePanelForTab(tabId, changeInfo.url);
    } catch (error) {
      console.error('更新标签页 URL 时更新侧边栏失败:', error);
    }
  }
});

/**
 * 保存认证信息到 storage，并记录来源
 */
async function saveAuthInfo(source, updates) {
  try {
    const stored = await chrome.storage.local.get(AUTH_STORAGE_KEY);
    const current = stored[AUTH_STORAGE_KEY] || {};
    const next = {
      ...current,
      ...updates,
      lastUpdatedAt: Date.now(),
      lastUpdatedBy: source,
    };
    await chrome.storage.local.set({ [AUTH_STORAGE_KEY]: next });
    console.log(`[aPaaS Tools] 认证信息已通过 ${source} 更新`);
  } catch (error) {
    console.error('[aPaaS Tools] 保存认证信息失败:', error);
  }
}

/**
 * 构造请求 headers，尽量对齐浏览器实际请求
 */
function buildRequestHeaders({ token, lane, referer, origin, contentType }) {
  const headers = {
    accept: 'application/json, text/plain, */*',
    'accept-language': 'zh-CN,zh;q=0.9',
    origin,
    priority: 'u=1, i',
    referer,
    'sec-ch-ua': '"Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"macOS"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'user-agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
    'x-ae-lane': lane || 'develop',
    'x-kunlun-apitype': 'design',
    'x-kunlun-fe-version': '93fe8df22b46__3299abd0-3f02-4ab8-a890-43d9773bbb3d',
    'x-kunlun-language-code': '2052',
    'x-kunlun-token': token,
    'x-lgw-os-type': '3',
    'x-lgw-terminal-type': '2',
  };

  if (lane) {
    headers['rpc-persist-lane-c-apaas-lane'] =
      lane === 'develop' ? 'lane_sandbox' : `lane_${lane}`;
  }

  if (contentType) {
    headers['content-type'] = contentType;
  }

  return headers;
}

function generateTraceparent() {
  const randomHex = (len) =>
    Array.from({ length: len }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `03-${randomHex(32)}-${randomHex(16)}-01`;
}

/**
 * 校验并获取认证信息
 */
async function getAuthContext(referer) {
  const stored = await chrome.storage.local.get(AUTH_STORAGE_KEY);
  const auth = stored[AUTH_STORAGE_KEY] || {};
  if (!auth.token) {
    throw new Error('未获取到 x-kunlun-token，请先刷新认证信息');
  }

  const cookieList = await chrome.cookies.getAll({ url: referer });
  const cookieString = cookieList.map((c) => `${c.name}=${c.value}`).join('; ');
  if (!cookieString) {
    throw new Error('未获取到 cookie，请确认已登录');
  }

  return { auth, cookieString };
}

/**
 * 通过 webRequest 捕获请求头中的 x-kunlun-token
 */
chrome.webRequest.onSendHeaders.addListener(
  (details) => {
    if (!details.requestHeaders) return;

    const tokenHeader = details.requestHeaders.find(
      (h) => h.name.toLowerCase() === 'x-kunlun-token'
    );

    if (tokenHeader && tokenHeader.value) {
      saveAuthInfo('webRequest', {
        token: tokenHeader.value,
        tokenUrl: details.url,
      });
    }
  },
  { urls: ['*://*.aedev.feishuapp.cn/*'] },
  ['requestHeaders']
);

/**
 * 接收 content script 采集的 cookie / token
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'AUTH_INFO_COLLECTED' && message.payload) {
    const { cookie, token, url } = message.payload;
    saveAuthInfo('contentScript', { cookie, token, url });
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === 'FETCH_LATEST_AUTH') {
    (async () => {
      try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const cookieList = await chrome.cookies.getAll({ url: activeTab?.url });
        const cookieString = cookieList.map((c) => `${c.name}=${c.value}`).join('; ');
        const stored = await chrome.storage.local.get(AUTH_STORAGE_KEY);
        const auth = stored[AUTH_STORAGE_KEY] || {};

        // 用 cookies API 获取的 cookie 覆盖 content script 的，确保包含 HttpOnly
        await saveAuthInfo('cookiesApi', { cookie: cookieString });

        sendResponse({ ok: true, auth: { ...auth, cookie: cookieString } });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
    })();
    return true;
  }

  if (message?.type === 'FETCH_OBJECTS') {
    (async () => {
      try {
        const { namespace, lane, origin, referer } = message.payload || {};
        if (!namespace || !origin) {
          sendResponse({ ok: false, error: '缺少 namespace 或 origin' });
          return;
        }

        const cookieUrl = referer || `${origin}/ae/data/ns/${namespace}/objects`;
        const { auth } = await getAuthContext(cookieUrl);

        const PAGE_SIZE = 50;

        async function fetchObjectPage(pageOffset) {
          const searchParams = new URLSearchParams({
            first: String(PAGE_SIZE),
            offset: String(pageOffset * PAGE_SIZE),
            sortBy: 'created_at',
            sortOrder: 'desc',
            includeCreateUpdateBy: 'true',
            includeAbandonedSysObject: 'false',
            objectType: '',
            includeReviewSharedObject: 'true',
            containDraft: 'true',
            contain_object_tag: 'true',
            abnormal_status: '',
          });

          const url = `${origin}/ae/api/v1/describe/namespaces/${encodeURIComponent(
            namespace
          )}/objects?${searchParams.toString()}`;

          const headers = buildRequestHeaders({
            token: auth.token,
            lane,
            referer: cookieUrl,
            origin,
          });
          headers.traceparent = generateTraceparent();

          const response = await fetch(url, {
            method: 'GET',
            headers,
            credentials: 'include',
          });

          const data = await response.json().catch(() => ({}));
          return {
            url,
            method: 'GET',
            headers,
            body: null,
            response: { status: response.status, data },
          };
        }

        // 先获取第一页，拿到 total
        const firstPage = await fetchObjectPage(0);
        const firstData = firstPage.response.data || {};
        if (firstPage.response.status !== 200 || firstData.status_code !== '0') {
          sendResponse({
            ok: false,
            error: `HTTP ${firstPage.response.status}: ${JSON.stringify(firstData)}`,
            meta: { requests: [firstPage] },
          });
          return;
        }

        const total = firstData.data?.total || 0;
        const totalPages = Math.ceil(total / PAGE_SIZE);
        const remainingRequests = [];
        for (let page = 1; page < totalPages; page++) {
          remainingRequests.push(fetchObjectPage(page));
        }
        const remainingPages = await Promise.all(remainingRequests);

        const allItems = [
          ...(firstData.data?.items || []),
          ...remainingPages.flatMap((page) => page.response.data?.data?.items || []),
        ];

        const combinedData = {
          ...firstData,
          data: {
            ...firstData.data,
            items: allItems,
            total,
          },
        };

        sendResponse({
          ok: true,
          data: combinedData,
          meta: { requests: [firstPage, ...remainingPages] },
        });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
    })();
    return true;
  }

  if (message?.type === 'EXPORT_OBJECT') {
    (async () => {
      try {
        const { namespace, objectApiId, lane, origin, referer } = message.payload || {};
        if (!namespace || !origin || !objectApiId) {
          sendResponse({ ok: false, error: '缺少 namespace、origin 或 objectApiId' });
          return;
        }

        const cookieUrl = referer || `${origin}/ae/data/ns/${namespace}/objects`;
        const { auth } = await getAuthContext(cookieUrl);

        const requests = [];

        // 1) 请求导出，获取 file_token
        const exportUrl = `${origin}/ae/api/v4/describe/namespaces/${encodeURIComponent(
          namespace
        )}/metaCopy/export/object`;
        const exportHeaders = buildRequestHeaders({
          token: auth.token,
          lane,
          referer: cookieUrl,
          origin,
          contentType: 'application/json',
        });
        exportHeaders.traceparent = generateTraceparent();
        const exportBody = { type: 'file', object_api_ids: [objectApiId] };

        const exportResponse = await fetch(exportUrl, {
          method: 'POST',
          headers: exportHeaders,
          body: JSON.stringify(exportBody),
          credentials: 'include',
        });

        const exportData = await exportResponse.json().catch(() => ({}));
        requests.push({
          url: exportUrl,
          method: 'POST',
          headers: exportHeaders,
          body: exportBody,
          response: { status: exportResponse.status, data: exportData },
        });

        if (!exportResponse.ok || exportData.status_code !== '0') {
          sendResponse({
            ok: false,
            error: `导出失败 HTTP ${exportResponse.status}: ${JSON.stringify(exportData)}`,
            meta: { requests },
          });
          return;
        }

        const fileToken = exportData.data?.file_token;
        if (!fileToken) {
          sendResponse({
            ok: false,
            error: '导出接口未返回 file_token',
            meta: { requests },
          });
          return;
        }

        // 2) 下载对象定义 JSON
        const downloadUrl = `${origin}/ae/api/v1/assets/attachment/download?token=${encodeURIComponent(
          fileToken
        )}`;
        const downloadHeaders = buildRequestHeaders({
          token: auth.token,
          lane,
          referer: cookieUrl,
          origin,
        });
        downloadHeaders.traceparent = generateTraceparent();

        const downloadResponse = await fetch(downloadUrl, {
          method: 'GET',
          headers: downloadHeaders,
          credentials: 'include',
        });

        const objectJson = await downloadResponse.json().catch(() => ({}));
        requests.push({
          url: downloadUrl,
          method: 'GET',
          headers: downloadHeaders,
          body: null,
          response: { status: downloadResponse.status, data: objectJson },
        });

        if (!downloadResponse.ok) {
          sendResponse({
            ok: false,
            error: `下载失败 HTTP ${downloadResponse.status}: ${downloadResponse.statusText}`,
            meta: { requests },
          });
          return;
        }

        sendResponse({
          ok: true,
          data: objectJson,
          meta: { requests },
        });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
    })();
    return true;
  }

  if (message?.type === 'CREATE_OBJECT') {
    (async () => {
      try {
        const { namespace, objectDef, lane, origin, referer } = message.payload || {};
        if (!namespace || !origin || !objectDef) {
          sendResponse({ ok: false, error: '缺少 namespace、origin 或 objectDef' });
          return;
        }

        const cookieUrl = referer || `${origin}/ae/data/ns/${namespace}/objects`;
        const { auth } = await getAuthContext(cookieUrl);

        const url = `${origin}/ae/api/v4/describe/namespaces/${encodeURIComponent(
          namespace
        )}/metaCopy/create/object`;
        const headers = buildRequestHeaders({
          token: auth.token,
          lane,
          referer: cookieUrl,
          origin,
          contentType: 'application/json',
        });
        headers.traceparent = generateTraceparent();
        const body = { create_type: 3, objects: [objectDef] };

        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          credentials: 'include',
        });

        const data = await response.json().catch(() => ({}));
        const requestInfo = { url, method: 'POST', headers, body };

        if (!response.ok || data.status_code !== '0') {
          sendResponse({
            ok: false,
            error: `创建失败 HTTP ${response.status}: ${JSON.stringify(data)}`,
            meta: { requests: [{ ...requestInfo, response: { status: response.status, data } }] },
          });
          return;
        }

        sendResponse({
          ok: true,
          data,
          meta: { requests: [{ ...requestInfo, response: { status: response.status, data } }] },
        });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
    })();
    return true;
  }
});
