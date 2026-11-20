import type { SkinErrorCode } from '../contracts/skin.js';

export const SKIN_TEXT = {
  title: '皮肤中心', providers: '皮肤站', siteUrl: '皮肤站网址', discover: '识别站点', addProvider: '添加皮肤站',
  api: '认证地址', open: '在浏览器管理衣柜与收藏', remove: '移除皮肤站', removeConfirm: '移除此站及其本地角色凭据？',
  confirm: '确认移除', cancel: '取消', loading: '正在处理…', retry: '重试',
  role: '游戏角色', providerType: '站点类型', login: '登录皮肤站', username: '邮箱', usernameOrRole: '邮箱或角色名',
  password: '密码', signin: '登录', chooseRole: '选择一个游戏角色', activateRole: '使用此角色', logout: '登出此角色',
  loggedOut: '已登出', revokeUnknown: '本机已登出，站点未确认撤销令牌。', rolePreview: '角色预览',
  noProvider: '输入站点首页或 Yggdrasil API 地址。', noRole: '登录后可选择角色、查看 UUID 和预览皮肤。',
  emptyPreview: '此角色当前没有可预览的材质。', enableWebGl: '3D 预览不可用，已显示皮肤材质。',
  enableWebGlEmpty: '3D 预览不可用。', model: '皮肤模型', preview: '预览所选文件', remotelyApplied: '上传并应用',
  localPreview: '本地 PNG 预览', chooseFile: '选择 PNG 文件', draftOnly: '这是本地预览。点击上传后才会修改角色皮肤。',
  chooseSignedIn: '选择允许上传皮肤的已登录角色后，可以应用此 PNG。',
  uploaded: '站点已接受并应用皮肤。', uploadedPreviewPending: '站点已接受皮肤，刷新角色预览后查看。', uploadRetry: '刷新角色预览',
} as const;

export const SKIN_ERRORS = {
  INVALID_ARGUMENT: '输入有误，请检查地址、角色与文件。',
  INVALID_SENDER: '此页面无权使用皮肤中心。',
  UNSUPPORTED_CONTRACT: '皮肤中心版本不兼容。',
  TIMEOUT: '站点请求超时，请稍后重试。',
  UNAVAILABLE: '皮肤中心暂不可用。',
  INVALID_URL: '请输入可公开访问的 HTTPS 皮肤站地址。',
  INCOMPATIBLE_PROVIDER: '未找到兼容的 Yggdrasil API。可尝试输入站点的完整 API 地址。',
  NOT_FOUND: '站点或角色不存在，或发现结果已过期。',
  AUTH_FAILED: '站点登录失败，请检查凭据及角色可用状态。',
  AUTH_EXPIRED: '角色会话已失效，请重新登录。',
  NO_ROLES: '站点未返回可用角色。请先在站点创建角色。',
  SECRET_UNAVAILABLE: '系统无法访问此角色的加密凭据。',
  NETWORK_FAILED: '站点通信失败，请检查网络和站点状态。',
  INVALID_TEXTURE: '皮肤或披风校验失败。请使用尺寸正确且完整的 PNG。',
  UPLOAD_UNSUPPORTED: '该角色未声明原生皮肤上传能力。',
  UPLOAD_REJECTED: '站点拒绝了上传。请查看站点的格式、配额与角色限制。',
  AGENT_UNAVAILABLE: '无法获得经过校验的认证 Agent。',
  CANCELLED: '操作已取消。',
} as const satisfies Record<SkinErrorCode, string>;
