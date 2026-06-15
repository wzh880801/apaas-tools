document.addEventListener('DOMContentLoaded', async () => {
  // ===== Tab 切换 =====
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabPanels = document.querySelectorAll('.tab-panel');
  const ACTIVE_TAB_KEY = 'activeTab';

  async function switchTab(tabName) {
    tabButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tabName));
    tabPanels.forEach((panel) => panel.classList.toggle('active', panel.dataset.panel === tabName));
    await chrome.storage.local.set({ [ACTIVE_TAB_KEY]: tabName });
  }

  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // 恢复上次选中的 tab
  const stored = await chrome.storage.local.get([
    ACTIVE_TAB_KEY,
    'sampleOption',
    'debugMode',
    'debugDetailLevel',
  ]);
  if (stored[ACTIVE_TAB_KEY]) {
    switchTab(stored[ACTIVE_TAB_KEY]);
  }

  // ===== 当前页面 Tab =====
  const getTabInfoBtn = document.getElementById('getTabInfo');
  const tabInfoEl = document.getElementById('tabInfo');

  getTabInfoBtn.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      tabInfoEl.textContent = JSON.stringify(
        {
          id: tab.id,
          title: tab.title,
          url: tab.url,
        },
        null,
        2
      );
    } catch (error) {
      tabInfoEl.textContent = `获取失败: ${error.message}`;
    }
  });

  // ===== 认证信息展示 =====
  const authTokenEl = document.getElementById('authToken');
  const authCookieEl = document.getElementById('authCookie');
  const refreshAuthBtn = document.getElementById('refreshAuth');

  function renderAuthInfo(auth = {}) {
    authTokenEl.textContent = auth.token ? maskToken(auth.token) : '未获取到 x-kunlun-token';
    authCookieEl.textContent = maskCookie(auth.cookie);

    // 给复制按钮绑定真实值
    document.querySelector('[data-copy="token"]').dataset.value = auth.token || '';
    document.querySelector('[data-copy="cookie"]').dataset.value = auth.cookie || '';
  }

  function maskToken(token) {
    if (!token || token.length <= 12) return token || '';
    return `${token.slice(0, 8)}...${token.slice(-8)}`;
  }

  function maskCookie(cookieStr) {
    if (!cookieStr) return '未获取到 cookie';
    return cookieStr
      .split('; ')
      .map((pair) => {
        const idx = pair.indexOf('=');
        if (idx === -1) return pair;
        const name = pair.slice(0, idx);
        let value = pair.slice(idx + 1);
        if (value.length > 8) {
          value = `${value.slice(0, 4)}...${value.slice(-4)}`;
        } else if (value.length > 0) {
          value = '***';
        }
        return `${name}=${value}`;
      })
      .join('; ');
  }

  async function loadAuthInfo() {
    const stored = await chrome.storage.local.get('authInfo');
    renderAuthInfo(stored.authInfo);
  }

  refreshAuthBtn.addEventListener('click', async () => {
    refreshAuthBtn.textContent = '刷新中...';
    refreshAuthBtn.disabled = true;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'FETCH_LATEST_AUTH' });
      if (response?.ok) {
        renderAuthInfo(response.auth);
      } else {
        authTokenEl.textContent = `刷新失败: ${response?.error || '未知错误'}`;
      }
    } catch (error) {
      authTokenEl.textContent = `刷新失败: ${error.message}`;
    } finally {
      refreshAuthBtn.textContent = '刷新认证信息';
      refreshAuthBtn.disabled = false;
    }
  });

  // 复制按钮
  document.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const value = btn.dataset.value || '';
      if (!value) return;
      try {
        await navigator.clipboard.writeText(value);
        const original = btn.textContent;
        btn.textContent = '已复制';
        setTimeout(() => (btn.textContent = original), 1200);
      } catch (error) {
        console.error('复制失败:', error);
      }
    });
  });

  // 监听 storage 变化，自动刷新展示
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.authInfo) {
      renderAuthInfo(changes.authInfo.newValue);
    }
  });

  // 初始加载
  await loadAuthInfo();

  // ===== 对象合并复制 Tab =====
  const objectNamespaceEl = document.getElementById('objectNamespace');
  const objectLaneEl = document.getElementById('objectLane');
  const loadObjectsBtn = document.getElementById('loadObjects');
  const mergeCreateObjectBtn = document.getElementById('mergeCreateObject');
  const objectFilterEl = document.getElementById('objectFilter');
  const selectAllObjectsEl = document.getElementById('selectAllObjects');
  const objectCountEl = document.getElementById('objectCount');
  const objectListEl = document.getElementById('objectList');
  const actionResultEl = document.getElementById('actionResult');
  const actionResultTextEl = document.getElementById('actionResultText');
  const debugPanel = document.getElementById('debugPanel');
  const debugOutput = document.getElementById('debugOutput');
  const debugExportBtn = document.getElementById('debugExport');
  const debugMergeBtn = document.getElementById('debugMerge');
  const debugCreateBtn = document.getElementById('debugCreate');

  const FORBIDDEN_OBJECTS = new Set(['_user', '_department']);

  let allObjects = [];
  let currentNamespace = '';
  let currentLane = '';
  let currentOrigin = '';
  let currentReferer = '';
  let debugObjectJsonList = [];

  function updateDebugPanel() {
    if (stored.debugMode) {
      debugPanel.classList.remove('hidden');
    } else {
      debugPanel.classList.add('hidden');
    }
  }

  function renderDebugValue(value) {
    if (value === null || value === undefined) return '<em>null</em>';
    if (typeof value === 'string') return escapeHtml(value);
    return escapeHtml(JSON.stringify(value, null, 2));
  }

  function renderDebugSection(title, content, open = true) {
    return `
      <details class="debug-section" ${open ? 'open' : ''}>
        <summary>${escapeHtml(title)}</summary>
        <div class="debug-section-content">
          <pre>${renderDebugValue(content)}</pre>
        </div>
      </details>
    `;
  }

  function getRequestSummary(req) {
    try {
      const urlObj = new URL(req.url);
      return `${req.method || 'GET'} ${urlObj.pathname}`;
    } catch {
      return `${req.method || 'GET'} ${req.url}`;
    }
  }

  function buildDebugCardBody(requests) {
    if (typeof requests === 'string') {
      return `<pre>${escapeHtml(requests)}</pre>`;
    }

    if (Array.isArray(requests)) {
      const isDetailed = stored.debugDetailLevel === 'detailed';
      return requests
        .map((req) => {
          const sections = [
            renderDebugSection('URL', `${req.method || 'GET'} ${req.url}`),
            renderDebugSection('Payload', req.body, false),
            isDetailed ? renderDebugSection('Headers', req.headers, false) : '',
            renderDebugSection('Response', req.response, false),
          ].join('');
          return `
            <details class="debug-request" open>
              <summary>${escapeHtml(getRequestSummary(req))}</summary>
              <div class="debug-request-content">
                ${sections}
              </div>
            </details>
          `;
        })
        .join('');
    }

    return renderDebugSection('Result', requests);
  }

  function logDebug(label, requests) {
    const timestamp = new Date().toLocaleTimeString();

    // 新增 card 前，先折叠所有已有 card
    debugOutput.querySelectorAll('.debug-card').forEach((card) => {
      card.classList.add('collapsed');
    });

    const card = document.createElement('div');
    card.className = 'debug-card';
    card.innerHTML = `
      <div class="debug-card-header">
        <span class="debug-card-title">[${timestamp}] ${escapeHtml(label)}</span>
        <button class="debug-card-toggle btn btn-sm">折叠</button>
      </div>
      <div class="debug-card-body">
        ${buildDebugCardBody(requests)}
      </div>
    `;

    const toggleBtn = card.querySelector('.debug-card-toggle');
    const header = card.querySelector('.debug-card-header');
    function toggleCard() {
      const isCollapsed = card.classList.toggle('collapsed');
      toggleBtn.textContent = isCollapsed ? '展开' : '折叠';
    }
    toggleBtn.addEventListener('click', toggleCard);
    header.addEventListener('click', (e) => {
      if (e.target !== toggleBtn) toggleCard();
    });

    debugOutput.prepend(card);
  }

  async function detectPageContext() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url) return;

      const url = new URL(tab.url);
      currentOrigin = url.origin;
      currentReferer = tab.url;

      // 从路径 /ae/data/ns/{namespace}/... 提取 namespace
      const nsMatch = url.pathname.match(/\/ae\/data\/ns\/([^/]+)/);
      currentNamespace = nsMatch ? nsMatch[1] : '';

      // 从查询参数 lane_id 提取 lane
      currentLane = url.searchParams.get('lane_id') || '';

      objectNamespaceEl.textContent = currentNamespace || '未识别';
      objectLaneEl.textContent = currentLane || '未识别';
    } catch (error) {
      console.error('识别页面上下文失败:', error);
    }
  }

  function getObjectLabel(item) {
    const labels = item.label || [];
    const label2052 = labels.find((l) => l.language_code === 2052);
    if (label2052?.text) return label2052.text;
    const label1033 = labels.find((l) => l.language_code === 1033);
    if (label1033?.text) return label1033.text;
    return item.api_alias || item.api_name || '未命名';
  }

  function renderObjectList(items) {
    objectListEl.innerHTML = '';
    allObjects = items;

    if (!items.length) {
      objectListEl.innerHTML = '<li class="object-empty">暂无对象</li>';
      updateObjectCount();
      return;
    }

    const filterText = (objectFilterEl.value || '').toLowerCase();

    items.forEach((item) => {
      const label = getObjectLabel(item);
      const apiAlias = item.api_alias || item.api_name || '';
      const apiName = item.api_name || item.api_alias || '';
      const displayText = `${label}(${apiAlias})`;

      if (filterText && !displayText.toLowerCase().includes(filterText)) {
        return;
      }

      // _user 和 _department 不支持选择/导出/合并
      if (FORBIDDEN_OBJECTS.has(apiAlias)) {
        const li = document.createElement('li');
        li.className = 'object-item object-item-disabled';
        li.innerHTML = `
          <input type="checkbox" disabled />
          <span>${escapeHtml(label)}<span class="object-alias">(${escapeHtml(apiAlias)})</span> <span class="object-forbidden">系统对象，不支持合并</span></span>
        `;
        objectListEl.appendChild(li);
        return;
      }

      const li = document.createElement('li');
      li.className = 'object-item';
      li.innerHTML = `
        <input type="checkbox" id="obj-${item.id}" value="${apiName}" data-alias="${escapeHtml(apiAlias)}" data-id="${item.id}" />
        <label for="obj-${item.id}">${escapeHtml(label)}<span class="object-alias">(${escapeHtml(apiAlias)})</span></label>
      `;
      objectListEl.appendChild(li);
    });

    if (!objectListEl.children.length) {
      objectListEl.innerHTML = '<li class="object-empty">无匹配对象</li>';
    }

    updateObjectCount();
    updateSelectAllState();
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function updateObjectCount() {
    const checkedCount = objectListEl.querySelectorAll('.object-item input:checked').length;
    objectCountEl.textContent = `共 ${allObjects.length} 个对象，选中 ${checkedCount} 个`;
    mergeCreateObjectBtn.disabled = checkedCount < 2;
  }

  function updateSelectAllState() {
    const checkboxes = objectListEl.querySelectorAll('.object-item input[type="checkbox"]');
    const checked = objectListEl.querySelectorAll('.object-item input[type="checkbox"]:checked');
    selectAllObjectsEl.checked = checkboxes.length > 0 && checkboxes.length === checked.length;
  }

  loadObjectsBtn.addEventListener('click', async () => {
    if (!currentNamespace) {
      objectListEl.innerHTML = '<li class="object-empty">未能识别 namespace，请确认当前页面 URL 包含 /ae/data/ns/{namespace}</li>';
      return;
    }

    loadObjectsBtn.textContent = '加载中...';
    loadObjectsBtn.disabled = true;
    actionResultEl.classList.add('hidden');
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'FETCH_OBJECTS',
        payload: {
          namespace: currentNamespace,
          lane: currentLane,
          origin: currentOrigin,
          referer: currentReferer,
        },
      });

      if (response?.ok) {
        const items = response.data?.data?.items || [];
        renderObjectList(items);
      } else {
        objectListEl.innerHTML = `<li class="object-empty">加载失败: ${escapeHtml(
          response?.error || '未知错误'
        )}</li>`;
        updateObjectCount();
      }
    } catch (error) {
      objectListEl.innerHTML = `<li class="object-empty">加载失败: ${escapeHtml(error.message)}</li>`;
      updateObjectCount();
    } finally {
      loadObjectsBtn.textContent = '加载对象列表';
      loadObjectsBtn.disabled = false;
    }
  });

  objectFilterEl.addEventListener('input', () => {
    renderObjectList(allObjects);
  });

  selectAllObjectsEl.addEventListener('change', () => {
    objectListEl
      .querySelectorAll('.object-item input[type="checkbox"]')
      .forEach((cb) => {
        cb.checked = selectAllObjectsEl.checked;
      });
    updateObjectCount();
  });

  objectListEl.addEventListener('change', (event) => {
    if (event.target.matches('input[type="checkbox"]')) {
      updateObjectCount();
      updateSelectAllState();
    }
  });

  // 切换到对象合并复制 tab 时自动识别当前页面上下文
  document.querySelector('[data-tab="objects"]').addEventListener('click', detectPageContext);
  await detectPageContext();

  // ===== 合并并创建新对象 =====
  let mergedObjectJson = null;

  function resolveUniqueName(name, usedSet) {
    if (!usedSet.has(name)) {
      usedSet.add(name);
      return name;
    }
    let i = 1;
    let candidate = `${name}_${i}`;
    while (usedSet.has(candidate)) {
      i++;
      candidate = `${name}_${i}`;
    }
    usedSet.add(candidate);
    return candidate;
  }

  const PRESERVED_SYSTEM_FIELDS = new Set([
    '_id',
    '_name',
    '_createdBy',
    '_createdAt',
    '_updatedBy',
    '_updatedAt',
  ]);

  function getEffectiveFieldName(fieldName, sourceObjectApiName) {
    // 保留字段保持原样
    if (PRESERVED_SYSTEM_FIELDS.has(fieldName)) {
      return fieldName;
    }
    // _ 开头的对象（如 _user、_department）其非保留 _ 字段需去掉前缀 _
    if (sourceObjectApiName.startsWith('_') && fieldName.startsWith('_')) {
      return fieldName.slice(1);
    }
    return fieldName;
  }

  function mergeObjectJsons(objectJsonList) {
    if (!objectJsonList.length) return null;
    const base = objectJsonList[0];
    const mergedApiName = `${base.object.api_name}_copy`;
    const usedFieldNames = new Set();
    const mergedFieldOrder = [];
    const mergedFields = [];

    for (const data of objectJsonList) {
      const sourceApiName = data.object?.api_name || '';

      if (data.object && Array.isArray(data.object.settings?.field_order)) {
        const localRenameMap = new Map();
        for (const field of data.object.settings.field_order) {
          // 非保留的系统字段（_ 开头）直接去重，以第一个对象的配置为准
          if (field.startsWith('_') && PRESERVED_SYSTEM_FIELDS.has(field)) {
            if (!usedFieldNames.has(field)) {
              usedFieldNames.add(field);
              localRenameMap.set(field, field);
              mergedFieldOrder.push(field);
            }
            continue;
          }

          const effectiveName = getEffectiveFieldName(field, sourceApiName);
          const uniqueName = resolveUniqueName(effectiveName, usedFieldNames);
          localRenameMap.set(field, uniqueName);
          mergedFieldOrder.push(uniqueName);
        }
        if (Array.isArray(data.fields)) {
          for (const field of data.fields) {
            // 保留的系统字段已存在则跳过
            if (PRESERVED_SYSTEM_FIELDS.has(field.api_name)) {
              const alreadyAdded = mergedFields.some((f) => f.api_name === field.api_name);
              if (!alreadyAdded) {
                mergedFields.push({ ...field });
              }
              continue;
            }

            const newName = localRenameMap.get(field.api_name) || field.api_name;
            mergedFields.push(
              newName !== field.api_name ? { ...field, api_name: newName } : { ...field }
            );
          }
        }
      } else {
        if (Array.isArray(data.fields)) {
          for (const field of data.fields) {
            if (PRESERVED_SYSTEM_FIELDS.has(field.api_name)) {
              const alreadyAdded = mergedFields.some((f) => f.api_name === field.api_name);
              if (!alreadyAdded) {
                mergedFields.push({ ...field });
                mergedFieldOrder.push(field.api_name);
              }
              continue;
            }

            const effectiveName = getEffectiveFieldName(field.api_name, sourceApiName);
            const uniqueName = resolveUniqueName(effectiveName, usedFieldNames);
            mergedFields.push(
              uniqueName !== field.api_name
                ? { ...field, api_name: uniqueName }
                : { ...field }
            );
            mergedFieldOrder.push(uniqueName);
          }
        }
      }
    }

    return {
      object: {
        ...base.object,
        api_name: mergedApiName,
        settings: {
          ...base.object.settings,
          field_order: mergedFieldOrder,
        },
      },
      fields: mergedFields,
    };
  }

  async function exportObject(apiAlias) {
    return chrome.runtime.sendMessage({
      type: 'EXPORT_OBJECT',
      payload: {
        namespace: currentNamespace,
        objectApiId: apiAlias,
        lane: currentLane,
        origin: currentOrigin,
        referer: currentReferer,
      },
    });
  }

  async function exportAndMergeSelected() {
    const selected = Array.from(
      objectListEl.querySelectorAll('.object-item input[type="checkbox"]:checked')
    ).map((cb) => cb.value);

    if (selected.length < 2) {
      throw new Error('请至少选择 2 个对象进行合并');
    }

    const results = await Promise.all(selected.map((apiAlias) => exportObject(apiAlias)));
    const failed = results.find((r) => !r?.ok);
    if (failed) {
      throw new Error(failed.error || '导出对象失败');
    }

    const objectJsonList = results.map((r) => r.data);
    debugObjectJsonList = objectJsonList;
    mergedObjectJson = mergeObjectJsons(objectJsonList);
    return { selectedCount: selected.length, mergedObjectJson };
  }

  mergeCreateObjectBtn.addEventListener('click', async () => {
    mergeCreateObjectBtn.textContent = '创建中...';
    mergeCreateObjectBtn.disabled = true;
    actionResultEl.classList.add('hidden');
    mergedObjectJson = null;

    try {
      await exportAndMergeSelected();

      const response = await chrome.runtime.sendMessage({
        type: 'CREATE_OBJECT',
        payload: {
          namespace: currentNamespace,
          objectDef: mergedObjectJson,
          lane: currentLane,
          origin: currentOrigin,
          referer: currentReferer,
        },
      });

      if (response?.ok) {
        const createdObject = response.data?.data?.object;
        const apiAlias = createdObject?.api_alias || createdObject?.api_name;
        actionResultTextEl.textContent = `创建成功: ${apiAlias} (ID: ${createdObject?.id})`;
      } else {
        actionResultTextEl.textContent = `创建失败: ${response?.error || '未知错误'}`;
      }
      actionResultEl.classList.remove('hidden');
    } catch (error) {
      actionResultTextEl.textContent = `创建失败: ${error.message}`;
      actionResultEl.classList.remove('hidden');
    } finally {
      mergeCreateObjectBtn.textContent = '合并为新对象';
      updateObjectCount();
    }
  });

  // ===== 调试按钮 =====
  debugExportBtn.addEventListener('click', async () => {
    const selected = Array.from(
      objectListEl.querySelectorAll('.object-item input[type="checkbox"]:checked')
    ).map((cb) => cb.value);

    if (!selected.length) {
      logDebug('导出调试', '请先选择至少一个对象');
      return;
    }

    debugExportBtn.textContent = '导出中...';
    debugExportBtn.disabled = true;
    try {
      const results = await Promise.all(selected.map((apiName) => exportObject(apiName)));
      debugObjectJsonList = results.filter((r) => r?.ok).map((r) => r.data);
      const failed = results.filter((r) => !r?.ok);
      const allRequests = results.flatMap((r) => r?.meta?.requests || []);
      logDebug('导出调试 - 请求/响应', allRequests);
      if (failed.length) {
        logDebug('导出调试 - 失败摘要', failed.map((r) => r.error));
      }
    } catch (error) {
      logDebug('导出调试 - 异常', error.message);
    } finally {
      debugExportBtn.textContent = '1. 调试导出接口';
      debugExportBtn.disabled = false;
    }
  });

  debugMergeBtn.addEventListener('click', () => {
    if (!debugObjectJsonList.length) {
      logDebug('合并调试', '请先执行步骤 1 导出对象');
      return;
    }
    try {
      mergedObjectJson = mergeObjectJsons(debugObjectJsonList);
      logDebug('合并调试 - 结果', mergedObjectJson);
    } catch (error) {
      logDebug('合并调试 - 异常', error.message);
    }
  });

  debugCreateBtn.addEventListener('click', async () => {
    if (!mergedObjectJson) {
      logDebug('创建调试', '请先执行步骤 2 合并 JSON');
      return;
    }

    debugCreateBtn.textContent = '创建中...';
    debugCreateBtn.disabled = true;
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'CREATE_OBJECT',
        payload: {
          namespace: currentNamespace,
          objectDef: mergedObjectJson,
          lane: currentLane,
          origin: currentOrigin,
          referer: currentReferer,
        },
      });

      logDebug('创建调试 - 请求/响应', response?.meta?.requests || []);
    } catch (error) {
      logDebug('创建调试 - 异常', error.message);
    } finally {
      debugCreateBtn.textContent = '3. 调试新建接口';
      debugCreateBtn.disabled = false;
    }
  });

  updateDebugPanel();

  // ===== 设置 Tab =====
  const sampleOptionEl = document.getElementById('sampleOption');
  sampleOptionEl.checked = stored.sampleOption ?? false;
  sampleOptionEl.addEventListener('change', () => {
    chrome.storage.local.set({ sampleOption: sampleOptionEl.checked });
  });

  const debugModeEl = document.getElementById('debugMode');
  const debugDetailLevelEl = document.getElementById('debugDetailLevel');

  function updateDebugDetailEnabled() {
    const enabled = debugModeEl.checked;
    debugDetailLevelEl.disabled = !enabled;
  }

  debugModeEl.checked = stored.debugMode ?? false;
  updateDebugDetailEnabled();
  debugModeEl.addEventListener('change', () => {
    stored.debugMode = debugModeEl.checked;
    chrome.storage.local.set({ debugMode: debugModeEl.checked });
    updateDebugPanel();
    updateDebugDetailEnabled();
  });

  debugDetailLevelEl.value = stored.debugDetailLevel || 'simple';
  debugDetailLevelEl.addEventListener('change', () => {
    stored.debugDetailLevel = debugDetailLevelEl.value;
    chrome.storage.local.set({ debugDetailLevel: debugDetailLevelEl.value });
  });
});
