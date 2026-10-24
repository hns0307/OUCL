export const MESSAGES = {
  appName: 'OUCL',
  welcome: '欢迎使用 OUCL',
  subtitle: '让社团的每一次相聚，从这里开始。',
  foundation: '基础环境已就绪',
  description: '游戏安装、实例管理与启动功能将在后续阶段逐步开放。',
  connecting: '正在准备…',
  connected: '准备完成',
  disconnected: '暂时无法连接，请关闭后重新打开。',
  invalidArgument: '请求内容无效。',
  unsupportedContract: '应用组件版本不兼容。',
  invalidSender: '请求来源不受信任。',
  unavailable: '暂时无法完成请求。',
  timeout: '连接超时，请重新打开应用。',
} as const;

export type MessageKey = keyof typeof MESSAGES;
