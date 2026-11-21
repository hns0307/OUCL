import type { RoomCode, RoomSnapshot, Transport } from '../contracts/multiplayer.js';

const roomErrors: Record<RoomCode, string> = {
  INVALID_ARGUMENT: '请检查联机设置或输入的端口。',
  INVALID_SENDER: '当前页面无法使用联机服务。',
  UNSUPPORTED_CONTRACT: '当前启动器版本无法处理此联机请求。',
  UNAVAILABLE: '暂时无法使用联机服务。',
  UNSUPPORTED_PLATFORM: '联机引擎需要 Windows x64 及完整的 OUCL 运行文件。',
  ENGINE_REQUIRED: '请先导入 EasyTier 官方运行档案。',
  ENGINE_INVALID: '档案校验失败。请选择指定版本的官方 Windows x64 ZIP。',
  ENGINE_START_FAILED: '联机引擎启动失败。请检查运行环境以及 Windows 防火墙的网络权限。',
  ROOM_BUSY: '请先关闭或退出当前房间。',
  SESSION_UNAVAILABLE: '游戏已退出，或当前启动器没有持有该游戏进程。',
  GAME_PORT_UNVERIFIED: '无法验证 Minecraft 端口。请打开单人世界的局域网选项并确认端口。',
  INVITE_INVALID: '邀请码无效或格式不受支持。',
  RELAY_REQUIRED: '跨网联机需要房主和访客配置同一个已获授权的私有中继。',
  NO_AUTHORIZED_ROUTE: '当前网络无法直连房主。请检查两台电脑是否处于同一个局域网。',
  ROOM_UNAVAILABLE: '房间服务暂不可用。',
  HOST_DISCONNECTED: '暂时无法连接房主。请检查房间、网络和中继设置。',
  CANCELLED: '已取消。',
  TIMEOUT: '联机操作超时。',
};
const phases: Record<RoomSnapshot['phase'], string> = {
  starting: '启动中', waiting: '等待连接', connected: '已连接', reconnecting: '正在重新连接', failed: '连接失败',
};
const transports: Record<Transport, string> = { lan: '局域网直连', direct: '点对点直连', relay: '私有中继', unknown: '等待确认路径' };
export const MULTIPLAYER_MESSAGES = {
  title: '联机中心', engineDialog: '选择 EasyTier Windows x64 官方 ZIP', engineImport: '导入引擎',
  engineMissing: '导入官方 EasyTier 2.6.4 Windows x64 CLI ZIP，即可创建和加入房间。',
  engineReady: '已导入 EasyTier 2.6.4',
  platformUnavailable: '当前环境缺少 Windows x64 联机组件。',
  hostHeading: '创建房间', hostHint: '通过 OUCL 启动游戏，在单人世界打开“对局域网开放”。',
  sessionPicker: '运行中的游戏', selectGame: '选择要分享的游戏', detectedPort: '已识别游戏端口',
  manualPort: '游戏端口（自动识别失败时填写）', create: '创建房间',
  joinHeading: '加入房间', inviteInput: '房主的邀请码', join: '加入房间',
  settingsHeading: '私有中继', settingsHint: '局域网可以直接联机。跨网联机由房主和访客分别配置同一个已获授权的中继。',
  relayAddress: 'EasyTier 中继地址', relayPin: '中继 X25519 公钥（Base64）', stunAddress: '已获授权的 STUN 地址（可选）',
  relaySave: '保存中继', relayClear: '清除中继',
  roleHost: '房主', roleGuest: '访客', hostClose: '关闭房间', guestLeave: '退出房间',
  copyInvite: '显示邀请码', inviteHint: '仅与同行玩家分享。房间关闭后失效。',
  copy: '复制', copied: '已复制', pasteAddress: '在 Minecraft“直接连接”中使用此地址',
  members: '联机节点', waitingMembers: '暂未发现其他玩家的联机节点。',
  errors: roomErrors, phases, transports,
} as const;
