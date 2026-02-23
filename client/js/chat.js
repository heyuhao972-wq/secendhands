import {
  loadIdentityKeyPair,
  loadX25519KeyPair,
  deriveChatKey,
  encrypt,
  decrypt,
  generateFingerprint,
} from "./crypto.js";

import {
  openChatSocket,
  sendChatTextMessage,
  sendJoinMessage,
  getChatHistory,
  getTradeChatInfo,
  updateChatPubkey,
  closeChatSocket,
} from "./api.js";

let currentTradeId = null;
let socket = null;
let identity = null;
let chatKeyPair = null;
let myChatPubKeyStr = null;
let isSeller = false;
let sellerChatPubKey = null;

const sessions = new Map();
let currentSessionPeer = null;

let onNewSession = null;
let onNewMessage = null;
let onSwitchSession = null;

/**
 * 规范化聊天公钥
 * @param {string|object} value - 聊天公钥，可以是字符串或包含pubkey属性的对象
 * @returns {string|null} 规范化后的聊天公钥，如果无效则返回null
 */
function normalizeChatPubKey(value) {
  if (!value) return null;

  let key = value;
  if (typeof key === "string") {
    try {
      const parsed = JSON.parse(key);
      if (parsed && parsed.pubkey) key = parsed.pubkey;
    } catch {
      
    }
  } else if (typeof key === "object" && key.pubkey) {
    key = key.pubkey;
  }

  if (typeof key !== "string") return null;
  const trimmed = key.trim();
  if (!trimmed) return null;
  if (!/^[A-Za-z0-9+/=]+$/.test(trimmed)) return null;
  return trimmed;
}

/**
 * 解析加密文本
 * @param {string|object} ciphertext - 加密文本，可以是字符串或对象
 * @returns {object|null} 解析后的加密文本对象，如果解析失败则返回null
 */
function parseCiphertext(ciphertext) {
  if (!ciphertext) return null;
  if (typeof ciphertext === "string") {
    try {
      return JSON.parse(ciphertext);
    } catch {
      return null;
    }
  }
  if (typeof ciphertext === "object") return ciphertext;
  return null;
}

/**
 * 将混合时间戳转换为Date对象
 * @param {number} ts - 时间戳，可以是秒或毫秒
 * @returns {Date} 转换后的Date对象
 */
function toDateFromMixedTimestamp(ts) {
  if (typeof ts !== "number") return new Date();
  // Server history uses seconds; local send uses milliseconds.
  return ts > 1e12 ? new Date(ts) : new Date(ts * 1000);
}

/**
 * 创建聊天会话
 * @param {string} peerChatPubKey - 对方的聊天公钥
 * @returns {object|null} 创建的会话对象，如果无效则返回null
 */
async function createSession(peerChatPubKey) {
  const normalizedPeer = normalizeChatPubKey(peerChatPubKey);
  if (!normalizedPeer) {
    throw new Error("Invalid peer chat pubkey");
  }

  if (normalizedPeer === myChatPubKeyStr) {
    return null;
  }

  if (sessions.has(normalizedPeer)) {
    return sessions.get(normalizedPeer);
  }

  const chatKey = await deriveChatKey(
    chatKeyPair.privateKey,
    normalizedPeer,
    currentTradeId
  );

  const session = {
    peerChatPubKey: normalizedPeer,
    chatKey,
    messages: [],
    unread: 0,
  };

  sessions.set(normalizedPeer, session);

  if (onNewSession) {
    let fingerprint = normalizedPeer.slice(0, 12) + "...";
    try {
      fingerprint = await Promise.resolve(generateFingerprint(normalizedPeer));
    } catch {
      // fallback already set
    }
    onNewSession({ chatPubKey: normalizedPeer, fingerprint });
  }

  return session;
}

/**
 * 建立初始会话
 * @param {object} tradeChatInfo - 交易聊天信息
 * @returns {Promise<void>}
 */
async function establishInitialSession(tradeChatInfo) {
  isSeller = tradeChatInfo.seller_pubkey === identity.publicKey;

  if (isSeller) {
    const buyerKey = normalizeChatPubKey(tradeChatInfo.buyer_chat_pubkey);
    if (buyerKey) {
      await createSession(buyerKey);
    }
    return;
  }

  sellerChatPubKey = normalizeChatPubKey(tradeChatInfo.seller_chat_pubkey);
  if (!sellerChatPubKey) {
    console.log("[chat] seller chat pubkey not ready yet");
    return;
  }
  await createSession(sellerChatPubKey);
}

/**
 * 添加解密后的消息到会话
 * @param {string} sessionKey - 会话密钥
 * @param {object} plaintext - 明文消息
 * @param {string} senderChatPubKey - 发送者的聊天公钥
 * @param {number} rawTimestamp - 原始时间戳
 * @returns {Promise<void>}
 */
async function appendDecryptedMessage(
  sessionKey,
  plaintext,
  senderChatPubKey,
  rawTimestamp,
  options = {}
) {
  const session = sessions.get(sessionKey);
  if (!session) return;
  const markUnread = options.markUnread !== false;
  const notifyUi = options.notifyUi !== false;

  const isOwn = senderChatPubKey === myChatPubKeyStr;
  const messageObj = {
    ...plaintext,
    timestamp: toDateFromMixedTimestamp(plaintext?.timestamp ?? rawTimestamp),
    isOwn,
  };
  session.messages.push(messageObj);

  if (markUnread && !isOwn && currentSessionPeer !== sessionKey) {
    session.unread += 1;
  }

  if (notifyUi && onNewMessage) {
    onNewMessage({
      sessionId: sessionKey,
      message: messageObj,
      unread: session.unread,
    });
  }
}

/**
 * 加载聊天历史
 * @returns {Promise<void>}
 */
async function loadChatHistory() {
  const history = await getChatHistory(currentTradeId);

  for (const msg of history) {
    const senderChatPubKey = normalizeChatPubKey(msg.sender_pubkey);
    const buyerChatPubKey = normalizeChatPubKey(msg.buyer_chat_pubkey);
    const ciphertext = parseCiphertext(msg.ciphertext);
    if (!senderChatPubKey || !ciphertext) continue;

    // Buyer only accepts seller-origin messages.
    if (!isSeller && sellerChatPubKey && senderChatPubKey !== myChatPubKeyStr && senderChatPubKey !== sellerChatPubKey) {
      continue;
    }

    let sessionKey = null;
    if (senderChatPubKey === myChatPubKeyStr) {
      // Outgoing history line: seller routes by buyer_chat_pubkey; buyer routes by seller key.
      sessionKey = isSeller ? buyerChatPubKey : sellerChatPubKey;
    } else {
      // Incoming history line: session key is sender's chat pubkey.
      sessionKey = senderChatPubKey;
    }

    if (!sessionKey) continue;
    if (!sessions.has(sessionKey)) {
      try {
        await createSession(sessionKey);
      } catch {
        continue;
      }
    }

    const session = sessions.get(sessionKey);
    if (!session) continue;

    try {
      const plaintext = await decrypt(session.chatKey, ciphertext);
      await appendDecryptedMessage(
        sessionKey,
        plaintext,
        senderChatPubKey,
        msg.timestamp,
        { markUnread: false, notifyUi: false }
      );
    } catch {
      // Cannot decrypt means not this session, ignore.
    }
  }

  if (!currentSessionPeer && sessions.size > 0) {
    currentSessionPeer = sessions.keys().next().value;
  }

  if (currentSessionPeer && onSwitchSession) {
    onSwitchSession(currentSessionPeer);
  }
}

/**
 * 处理加入消息
 * @param {object} msg - 消息对象
 * @returns {Promise<void>}
 */
async function handleJoinMessage(msg) {
  const identityPub = msg?.identity_pubkey;
  const chatPub = normalizeChatPubKey(msg?.chat_pubkey);
  if (!chatPub) return;

  if (identityPub && identityPub === identity?.publicKey) return;
  if (chatPub === myChatPubKeyStr) return;

  // Buyer only keeps session with seller.
  if (!isSeller && sellerChatPubKey && chatPub !== sellerChatPubKey) {
    return;
  }

  try {
    await createSession(chatPub);
  } catch {
    // Ignore invalid join key.
  }
}

/**
 * 处理聊天消息
 * @param {object} msg - 消息对象
 * @returns {Promise<void>}
 */
async function handleChatMessage(msg) {
  const senderChatPubKey = normalizeChatPubKey(msg?.sender_chat_pubkey);
  const ciphertext = parseCiphertext(msg?.ciphertext);
  if (!senderChatPubKey || !ciphertext) return;

  if (senderChatPubKey === myChatPubKeyStr) return;

  // Buyer only accepts seller-origin messages.
  if (!isSeller && sellerChatPubKey && senderChatPubKey !== sellerChatPubKey) {
    return;
  }

  if (!sessions.has(senderChatPubKey)) {
    try {
      await createSession(senderChatPubKey);
    } catch {
      return;
    }
  }

  const session = sessions.get(senderChatPubKey);
  if (!session) return;

  try {
    const plaintext = await decrypt(session.chatKey, ciphertext);
    await appendDecryptedMessage(
      senderChatPubKey,
      plaintext,
      senderChatPubKey,
      msg.timestamp
    );
  } catch {
    // Decrypt failed: ignore.
  }
}

/**
 * 处理WebSocket消息
 * @param {string|object} msg - 消息，可以是字符串或对象
 * @returns {Promise<void>}
 */
async function handleSocketMessage(msg) {
  let parsed = msg;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return;
    }
  }

  switch (parsed?.type) {
    case "JOIN":
      await handleJoinMessage(parsed);
      break;
    case "CHAT":
      await handleChatMessage(parsed);
      break;
    case "PONG":
      break;
    default:
      break;
  }
}

/**
 * 初始化聊天系统
 * @param {string} tradeId - 交易ID
 * @param {object} uiCallbacks - UI回调函数
 * @param {function} uiCallbacks.onNewSession - 新会话创建时的回调
 * @param {function} uiCallbacks.onNewMessage - 新消息收到时的回调
 * @param {function} uiCallbacks.onSwitchSession - 会话切换时的回调
 * @returns {Promise<object>} 初始化结果
 */
export async function initChat(tradeId, uiCallbacks = {}) {
  currentTradeId = tradeId;
  onNewSession = uiCallbacks.onNewSession || null;
  onNewMessage = uiCallbacks.onNewMessage || null;
  onSwitchSession = uiCallbacks.onSwitchSession || null;

  sessions.clear();
  currentSessionPeer = null;
  sellerChatPubKey = null;

  identity = await loadIdentityKeyPair();
  if (!identity) {
    throw new Error("请先创建身份");
  }

  chatKeyPair = await loadX25519KeyPair();
  myChatPubKeyStr = normalizeChatPubKey(chatKeyPair.publicKey);
  if (!myChatPubKeyStr) {
    throw new Error("本地聊天公钥无效");
  }

  try {
    await updateChatPubkey(tradeId, identity.publicKey, myChatPubKeyStr);
  } catch (error) {
    console.warn("[chat] update chat pubkey failed:", error?.message || error);
  }

  const tradeChatInfo = await getTradeChatInfo(tradeId);
  await establishInitialSession(tradeChatInfo);
  await loadChatHistory();

  socket = await openChatSocket(
    tradeId,
    identity.publicKey,
    myChatPubKeyStr,
    handleSocketMessage
  );

  sendJoinMessage(myChatPubKeyStr);
  return { success: true, sessions: Array.from(sessions.keys()) };
}

/**
 * 切换会话
 * @param {string} peerChatPubKey - 对方的聊天公钥
 * @returns {boolean} 切换是否成功
 */
export function switchSession(peerChatPubKey) {
  const normalizedPeer = normalizeChatPubKey(peerChatPubKey);
  if (!normalizedPeer || !sessions.has(normalizedPeer)) {
    return false;
  }

  currentSessionPeer = normalizedPeer;
  const session = sessions.get(normalizedPeer);
  if (session) session.unread = 0;

  if (onSwitchSession) {
    onSwitchSession(normalizedPeer);
  }
  return true;
}

/**
 * 获取当前会话
 * @returns {object|null} 当前会话对象，如果没有则返回null
 */
export function getCurrentSession() {
  if (!currentSessionPeer) return null;
  return sessions.get(currentSessionPeer) || null;
}

/**
 * 获取所有会话
 * @returns {array} 会话公钥数组
 */
export function getSessions() {
  return Array.from(sessions.keys());
}

/**
 * 获取指定会话
 * @param {string} peerChatPubKey - 对方的聊天公钥
 * @returns {object|null} 会话对象，如果没有则返回null
 */
export function getSession(peerChatPubKey) {
  const normalizedPeer = normalizeChatPubKey(peerChatPubKey);
  if (!normalizedPeer) return null;
  return sessions.get(normalizedPeer) || null;
}

/**
 * 发送消息
 * @param {string} text - 消息文本
 * @returns {Promise<boolean>} 发送是否成功
 */
export async function sendMessage(text) {
  if (!currentSessionPeer) {
    throw new Error("请先选择聊天对象");
  }

  const session = sessions.get(currentSessionPeer);
  if (!session) {
    throw new Error("会话不存在");
  }

  const plaintext = {
    trade_id: currentTradeId,
    sender_pubkey: myChatPubKeyStr,
    content: text,
    message: text,
    timestamp: Date.now(),
    type: "CHAT",
  };

  const encrypted = await encrypt(session.chatKey, plaintext);
  const buyerChatPubKey = isSeller ? currentSessionPeer : myChatPubKeyStr;

  sendChatTextMessage(
    JSON.stringify(encrypted),
    myChatPubKeyStr,
    buyerChatPubKey
  );

  await appendDecryptedMessage(
    currentSessionPeer,
    plaintext,
    myChatPubKeyStr,
    plaintext.timestamp
  );

  return true;
}

/**
 * 列出所有会话
 * @returns {array} 会话信息数组
 */
export function listSessions() {
  return Array.from(sessions.entries()).map(([chatPubKey, session]) => ({
    chatPubKey,
    fingerprint: generateFingerprint(chatPubKey),
    unread: session.unread,
    lastMessage: session.messages[session.messages.length - 1] || null,
  }));
}

/**
 * 获取会话消息
 * @param {string} chatPubKey - 聊天公钥
 * @returns {array} 消息数组
 */
export function getSessionMessages(chatPubKey) {
  const normalizedPeer = normalizeChatPubKey(chatPubKey);
  if (!normalizedPeer) return [];
  const session = sessions.get(normalizedPeer);
  return session ? session.messages : [];
}

/**
 * 关闭聊天
 * @returns {void}
 */
export function closeChat() {
  closeChatSocket();
  socket = null;
  currentTradeId = null;
  identity = null;
  chatKeyPair = null;
  myChatPubKeyStr = null;
  isSeller = false;
  sellerChatPubKey = null;
  sessions.clear();
  currentSessionPeer = null;
}

/**
 * 检查聊天是否连接
 * @returns {boolean} 是否连接
 */
export function isChatConnected() {
  return !!socket && socket.readyState === WebSocket.OPEN;
}
