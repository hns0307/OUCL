import type { WebDownloadState, WebErrorCode, WebFileKind } from '../contracts/web-extensions.js';

export const WEB_TEXT = {
  title: '网站中心', newTab: '新标签页', untitled: '新标签页', tabs: '网页标签', closeTab: '关闭标签页',
  address: 'HTTPS 网址', go: '打开', placeholder: '输入网址', back: '后退', forward: '前进',
  refresh: '刷新', zoomOut: '缩小网页', zoomIn: '放大网页', external: '在系统浏览器打开',
  bookmark: '收藏当前页', bookmarks: '收藏', remove: '移除', clear: '结束网站会话',
  downloads: '网页下载', confirmDownload: '下载', cancel: '取消', export: '另存为', import: '导入实例',
  root: '选择隔离实例', prepareMod: '交给 Mod 资源库', skin: '在皮肤中心预览',
  packExport: '已识别 Modrinth 整合包，可另存。', importsOther: '无法匹配安装来源的文件可另存。',
  packName: '新隔离实例名称', installPack: '新建隔离实例', packFiles: '必需文件', packOptional: '可选文件', packOverrides: '配置覆盖文件',
  packQueued: '已创建整合包安装任务，可在任务中心查看。',
  layoutWait: '网页加载中…', loadFailed: '页面加载失败。可重试，或在系统浏览器打开。',
  popup: '站点请求打开', acceptPopup: '在新标签页打开', browserFallback: '部分站点的登录流程需要系统浏览器。',
  imported: '已导入实例', resourceQueued: '已加入资源下载任务。完成后可在资源库确认安装。',
  archiveRejected: '文件结构无效或超出检查限制。', empty: '输入网址即可浏览。', unavailable: '网站中心暂不可用。',
} as const;

export const WEB_ERRORS_TEXT: Record<WebErrorCode, string> = {
  INVALID_ARGUMENT: '请求参数无效。', INVALID_SENDER: '页面权限已失效。', UNSUPPORTED_CONTRACT: '网站服务版本不兼容。',
  URL_BLOCKED: '该网址不符合公开 HTTPS 浏览规则。', LIMIT: '已达到网站中心的数量或大小限制。',
  NOT_FOUND: '找不到所选项目。', REQUEST_CONFLICT: '请求已变更。', TIMEOUT: '操作超时，请查看当前状态。',
  UNAVAILABLE: '操作暂时不可用。', INSTANCE_BUSY: '实例正在运行或维护。', INSTANCE_CHANGED: '实例已变更，请重新选择。',
  FILE_EXISTS: '目标文件已存在。', UNSUPPORTED_IMPORT: '当前文件没有可用的导入方式。',
};

export const WEB_DOWNLOAD_STATE: Record<WebDownloadState, string> = {
  confirmation: '待确认', downloading: '下载中', checking: '检查文件', ready: '已下载',
  failed: '下载失败', cancelled: '已取消',
};

export const WEB_FILE_KIND: Record<WebFileKind, string> = {
  unknown: '文件', mod: 'Mod', modpack: '整合包', resourcepack: '资源包', shader: '光影包', skin: '皮肤',
};
