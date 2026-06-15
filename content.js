(function () {
  'use strict';

  const TOKEN_KEYS = ['x-kunlun-token', 'X-Kunlun-Token', 'X-KUNLUN-TOKEN'];

  function findToken() {
    const sources = [
      { name: 'localStorage', store: window.localStorage },
      { name: 'sessionStorage', store: window.sessionStorage },
    ];

    for (const { store } of sources) {
      for (const key of TOKEN_KEYS) {
        const value = store.getItem(key);
        if (value) return value;
      }
      // 也尝试遍历所有 key，找到包含 kunlun 的 token
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i);
        if (key && /kunlun/i.test(key)) {
          const value = store.getItem(key);
          if (value) return value;
        }
      }
    }

    return '';
  }

  function collectAuthInfo() {
    return {
      url: location.href,
      cookie: document.cookie || '',
      token: findToken(),
      timestamp: Date.now(),
    };
  }

  function sendAuthInfo() {
    try {
      chrome.runtime.sendMessage({
        type: 'AUTH_INFO_COLLECTED',
        payload: collectAuthInfo(),
      });
    } catch (error) {
      console.error('[aPaaS Tools] 发送认证信息失败:', error);
    }
  }

  // 页面加载完成后立即发送一次
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', sendAuthInfo);
  } else {
    sendAuthInfo();
  }

  // 监听 storage 变化，token 更新时再次发送
  window.addEventListener('storage', (event) => {
    if (event.key && /kunlun/i.test(event.key)) {
      sendAuthInfo();
    }
  });
})();
