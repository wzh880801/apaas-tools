# aPaaS Tools

一个基于 Chrome Side Panel API 的浏览器扩展，用于 aPaaS 平台的开发辅助工具。

## 功能

- **右侧侧边栏**：点击扩展图标即可将面板固定到 Chrome 右侧
- **域名限制**：仅在 `*.aedev.feishuapp.cn` 域名下可用
- **认证信息采集**：自动获取当前页面的 `x-kunlun-token` 和 `cookie`
- **对象合并复制**：
  - 自动识别当前 namespace
  - 翻页拉取所有对象列表
  - 选择 2 个及以上对象合并复制为新对象
  - 不影响任何已有对象
- **调试模式**：支持分步调试导出/合并/创建接口，可查看完整 request/response

## 项目结构

```
.
├── manifest.json          # 扩展配置（Manifest V3）
├── background.js          # Service Worker 后台脚本
├── content.js             # 注入目标页面的内容脚本
├── sidepanel/             # 侧边栏面板
│   ├── index.html
│   ├── styles.css
│   └── index.js
├── icons/                 # 扩展图标
├── .gitignore
└── README.md
```

## 本地安装

1. 打开 Chrome，进入 `chrome://extensions/`
2. 右上角开启「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择本项目根目录
5. 点击工具栏中的扩展图标即可打开/关闭右侧侧边栏

## 使用说明

### 对象合并复制

1. 进入 aPaaS 对象管理页面（URL 包含 `/ae/data/ns/{namespace}`）
2. 打开扩展侧边栏，切换到「对象合并复制」Tab
3. 点击「加载对象列表」，会自动翻页拉取所有对象
4. 勾选 2 个及以上对象（`_user`、`_department` 不可选）
5. 点击「合并为新对象」

### 调试模式

1. 进入「设置」Tab，勾选「启用调试模式」
2. 回到「对象合并复制」Tab，底部会出现调试面板
3. 可按步骤单独调试导出接口、JSON 合并、新建接口
4. 调试输出模式可在「精简」和「详细」之间切换

## 开发说明

- 使用 Chrome Manifest V3
- 使用 `chrome.sidePanel` API 实现右侧固定面板
- 使用 `chrome.webRequest` 捕获请求头
- 使用 `chrome.cookies` API 获取完整 cookie
- 对象列表接口支持自动翻页加载
