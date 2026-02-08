/**
 * chat.js - 聊天系统核心模块
 * 
 * 主要功能：
 * 1. 聊天系统初始化与管理
 * 2. 会话创建与密钥派生（基于X25519 ECDH）
 * 3. 消息加密传输（AES-256-GCM）
 * 4. 历史消息加载与显示
 * 5. WebSocket连接管理
 */

import {
  loadIdentityKeyPair,
  loadX25519KeyPair,
  deriveChatKey,
  encrypt,
  decrypt,
  generateFingerprint
} from "./crypto.js";

import {
  openChatSocket,
  sendChatTextMessage,
  sendJoinMessage,
  getChatHistory,
  getTradeChatInfo,
  updateChatPubkey,
  getPeerChatPubkey,
  closeChatSocket
} from "./api.js";

/**
 * 聊天系统控制器 - 核心状态管理
 */

// 当前交易ID
let currentTradeId = null;
// WebSocket连接实例
let socket = null;
// 当前用户身份密钥对
let identity = null;
// 当前用户聊天密钥对（X25519）
let chatKeyPair = null;
// 当前用户聊天公钥（字符串形式）
let myChatPubKeyStr = null;
// 当前用户是否为卖家
let isSeller = false;
// 卖家聊天公钥（买家视角）
let sellerChatPubKey = null;

function normalizeChatPubKey(value) {
  if (!value) return null;
  let key = value;
  if (typeof key === "string") {
    try {
      const parsed = JSON.parse(key);
      if (parsed && parsed.pubkey) key = parsed.pubkey;
    } catch (e) {
      // 不是 JSON，继续用原字符串
    }
  } else if (key.pubkey) {
    key = key.pubkey;
  }
  if (typeof key !== "string") return null;
  const base64Like = /^[A-Za-z0-9+/=]+$/.test(key);
  return base64Like ? key : null;
}






// 会话管理：存储所有活跃的聊天会话
const sessions = new Map(); // peerChatPubKey -> { chatKey, messages }
// 当前选中的会话对端公钥
let currentSessionPeer = null;

// UI回调函数 - 用于更新界面
let onNewSession = null;      // 新会话创建时的回调
let onNewMessage = null;      // 新消息到达时的回调
let onSwitchSession = null;   // 切换会话时的回调

// ==========================
// 初始化聊天系统
// ========================

export async function initChat(tradeId, uiCallbacks = {}) {
  try {
    console.log("[chat] 开始初始化聊天系统，交易ID:", tradeId);
    
    currentTradeId = tradeId;
    
    // 设置UI回调函数
    onNewSession = uiCallbacks.onNewSession;
    onNewMessage = uiCallbacks.onNewMessage;
    onSwitchSession = uiCallbacks.onSwitchSession;
    
    // 1. 加载当前用户身份密钥对
    console.log("[chat] 加载用户身份密钥对");
    identity = await loadIdentityKeyPair();
    if (!identity) {
      throw new Error("请先创建身份");
    }
    
    // 2. 加载或生成X25519聊天密钥对
    console.log("[chat] 加载X25519聊天密钥对");
    chatKeyPair = await loadX25519KeyPair();
    myChatPubKeyStr = chatKeyPair.publicKey;
    console.log("[chat] 我的聊天公钥:", myChatPubKeyStr.substring(0, 12) + "...");
    
    // 3. 更新聊天公钥到服务器（非关键步骤，失败不影响后续流程）
    try {
      console.log("[chat] 更新聊天公钥到服务器");
      await updateChatPubkey(tradeId, identity.publicKey, myChatPubKeyStr);
    } catch (error) {
      console.warn("[chat] 更新聊天公钥失败:", error.message);
      // 即使更新失败，也继续执行后续步骤
    }
    
    // 4. 获取交易聊天信息
    console.log("[chat] 获取交易聊天信息");
    const tradeChatInfo = await getTradeChatInfo(tradeId);
    console.log("[chat] 交易聊天信息:", {
      seller_pubkey: tradeChatInfo.seller_pubkey?.substring(0, 12) + "...",
      buyer_pubkey: tradeChatInfo.buyer_pubkey?.substring(0, 12) + "...",
      status: tradeChatInfo.status
    });
    
    // 5. 尝试建立与对方的初始会话
    console.log("[chat] 建立初始聊天会话");
    await establishInitialSession(tradeChatInfo);
    
    // 6. 打开WebSocket连接
    console.log("[chat] 打开WebSocket连接");
    socket = await openChatSocket(
      tradeId,
      identity.publicKey,
      myChatPubKeyStr,
      handleSocketMessage
    );
    
    // 7. 发送JOIN消息通知对方
    console.log("[chat] 发送JOIN消息通知对方");
    sendJoinMessage(myChatPubKeyStr);
    
    // 8. 加载历史消息
    console.log("[chat] 加载聊天历史消息");
    await loadChatHistory();
    
    console.log("[chat] 聊天系统初始化完成");
    return { success: true, sessions: Array.from(sessions.keys()) };
  } catch (error) {
    console.error("[chat] 初始化失败:", error);
    throw error;
  }
}

/**
 * 建立初始会话
 */
async function establishInitialSession(tradeChatInfo) {
  isSeller = tradeChatInfo.seller_pubkey === identity.publicKey;
  const isSellerFlag = isSeller;

  if (isSellerFlag) {
    // 卖家视角：检查是否有买家聊天公钥
    let buyerChatPubKey = normalizeChatPubKey(tradeChatInfo.buyer_chat_pubkey);
    if (buyerChatPubKey) {
      await createSession(buyerChatPubKey, false);
    } else {
      console.log("[chat] 等待买家加入聊天...");
    }
  } else {
    // 买家视角：获取卖家聊天公钥并创建会话
    let sellerKey = normalizeChatPubKey(tradeChatInfo.seller_chat_pubkey);
    if (sellerKey) {
      sellerChatPubKey = sellerKey;
      await createSession(sellerKey, false);
    }
  }
}




/**
 * 创建新会话
 */
async function createSession(peerChatPubKey, isInitiator = true) {
  // 检查会话是否已存在，避免重复创建
  if (sessions.has(peerChatPubKey)) {
    console.log("[chat] 会话已存在，复用现有会话");
    return sessions.get(peerChatPubKey);
  }
  
  console.log("[chat] 创建新会话，对方公钥:", peerChatPubKey.substring(0, 12) + "...");
  
  try {
    // 派生聊天密钥（基于X25519 ECDH）
    console.log("[chat] 开始派生聊天密钥");
    const chatKey = await deriveChatKey(
      chatKeyPair.privateKey,
      peerChatPubKey,
      currentTradeId
    );
    console.log("[chat] 聊天密钥派生成功");
    
    // 创建会话对象
    const session = {
      peerChatPubKey,   // 对方聊天公钥
      chatKey,          // 派生的聊天密钥（AES-256-GCM）
      messages: [],     // 消息历史
      unread: 0         // 未读消息计数
    };
    
    // 保存会话
    sessions.set(peerChatPubKey, session);
    console.log("[chat] 会话创建成功，已添加到会话管理");
    
    // 通知UI创建了新会话
    if (onNewSession) {
      try {
        // 生成对方公钥的指纹（方便用户识别）
        const fingerprint = await Promise.resolve(generateFingerprint(peerChatPubKey));
        console.log("[chat] 对方指纹:", fingerprint);
        
        onNewSession({
          chatPubKey: peerChatPubKey,
          fingerprint: fingerprint
        });
      } catch (error) {
        console.error("[chat] 调用onNewSession失败:", error);
        // 降级处理：直接显示公钥前缀
        onNewSession({
          chatPubKey: peerChatPubKey,
          fingerprint: String(peerChatPubKey).slice(0, 12) + "..."
        });
      }
    }
    
    return session;
  } catch (error) {
    console.error("[chat] 创建会话失败:", error);
    throw error;
  }
}

/**
 * 加载聊天历史
 */
async function loadChatHistory() {
  console.log("[chat] 开始加载聊天历史消息");

  try {
    // 从服务器获取历史消息
    const history = await getChatHistory(currentTradeId);
    console.log("[chat] 获取到历史消息数量:", history.length);
    
    for (const msg of history) {
      const senderPubKey = msg.sender_pubkey;
      const buyerChatPubKey = msg.buyer_chat_pubkey;
      
      // 权限检查：买家只接受卖家的消息
      if (!isSeller && sellerChatPubKey && senderPubKey && senderPubKey !== sellerChatPubKey) {
        console.debug("[chat] 忽略非卖家消息");
        continue;
      }
      
      // 查找或创建会话
      let session = null;
      
      // 情况1：消息来自对方
      if (senderPubKey && senderPubKey !== myChatPubKeyStr) {
        session = sessions.get(senderPubKey);
        if (!session) {
          session = await createSession(senderPubKey, false);
        }
      }
      // 情况2：卖家收到的消息
      else if (isSeller && buyerChatPubKey) {
        session = sessions.get(buyerChatPubKey);
        if (!session) {
          session = await createSession(buyerChatPubKey, false);
        }
      }
      
      // 解密消息
      const ciphertext = JSON.parse(msg.ciphertext);
      let decrypted = null;
      
      if (session) {
        try {
          decrypted = await decrypt(session.chatKey, ciphertext);
        } catch (decryptError) {
          console.debug("[chat] 解密失败，尝试其他会话密钥");
        }
      } else {
        // 尝试使用所有会话密钥解密
        for (const s of sessions.values()) {
          try {
            decrypted = await decrypt(s.chatKey, ciphertext);
            session = s;
            break;
          } catch (decryptError) {
            // 忽略解密失败
          }
        }
      }
      
      // 保存解密后的消息
      if (decrypted && session) {
        session.messages.push({
          ...decrypted,
          timestamp: new Date(msg.timestamp * 1000),
          isOwn: senderPubKey === myChatPubKeyStr
        });
      }
    }
    
    console.log("[chat] 历史消息加载完成");
  } catch (error) {
    console.warn("[chat] 加载历史消息失败:", error);
  }
}




// WebSocket消息处理


async function handleSocketMessage(msg) {
  // WebSocket消息处理函数
  console.log("[chat] 收到WebSocket消息:", msg.type);
  
  try {
    if (typeof msg === 'string') {
      msg = JSON.parse(msg);
    }
    
    switch (msg.type) {
      case "JOIN":
        await handleJoinMessage(msg);
        break;
        
      case "CHAT":
        await handleChatMessage(msg);
        break;
        
      case "PONG":
        // 心跳响应，不做处理
        console.debug("[chat] 收到心跳响应");
        break;
        
      default:
        console.warn("[chat] 未知消息类型:", msg.type);
    }
  } catch (error) {
    // 忽略解析错误的消息
    console.debug("[chat] 消息解析失败:", error.message);
  }
}

async function handleJoinMessage(msg) {
  const { identity_pubkey, chat_pubkey } = msg;
  
  console.log("[chat] 处理JOIN消息，身份公钥:", identity_pubkey?.substring(0, 12) + "...");

  // 规范化聊天公钥
  const normalizedChatPubKey = normalizeChatPubKey(chat_pubkey);
  if (!normalizedChatPubKey) return;

  // 买家只接受卖家的聊天公钥
  if (!isSeller && sellerChatPubKey && normalizedChatPubKey !== sellerChatPubKey) return;

  // 创建会话
  await createSession(normalizedChatPubKey, false);

  
  // 忽略自己的消息
  if (identity_pubkey === identity.publicKey) {
    console.debug("[chat] 忽略自己的JOIN消息");
    return;
  }
  
  // 买家只接受卖家加入
  if (!isSeller && sellerChatPubKey && chat_pubkey !== sellerChatPubKey) {
    console.debug("[chat] 买家忽略非卖家的JOIN消息");
    return;
  }

  // 创建会话
  if (chat_pubkey) {
    console.log("[chat] 根据JOIN消息创建新会话");
    await createSession(chat_pubkey, false);
  }
}

async function handleChatMessage(msg) {
  const { sender_chat_pubkey, ciphertext } = msg;
  
  console.log("[chat] 处理CHAT消息，发送方:", sender_chat_pubkey.substring(0, 12) + "...");
  
  // 忽略自己的消息（根据聊天公钥判断）
  if (sender_chat_pubkey === myChatPubKeyStr) {
    console.debug("[chat] 忽略自己的CHAT消息");
    return;
  }

  // 买家端：只接受卖家的消息
  if (!isSeller && sellerChatPubKey && sender_chat_pubkey !== sellerChatPubKey) {
    console.debug("[chat] 买家忽略非卖家的CHAT消息");
    return;
  }
  
  // 查找会话
  let session = sessions.get(sender_chat_pubkey);
  if (!session && sender_chat_pubkey) {
    // 创建新会话
    console.log("[chat] 消息来自新会话，创建会话");
    session = await createSession(sender_chat_pubkey, false);
  }
  
  if (!session) {
    console.warn("[chat] 收到未知会话的消息，忽略");
    return;
  }
  
  try {
    // 解密消息
    console.log("[chat] 解密收到的消息");
    const plaintext = await decrypt(session.chatKey, JSON.parse(ciphertext));
    
    // 添加到消息历史
    const messageObj = {
      ...plaintext,
      timestamp: new Date(plaintext.timestamp),
      isOwn: false
    };
    
    session.messages.push(messageObj);
    console.log("[chat] 消息已添加到历史记录");
    
    // 如果当前不是这个会话，标记为未读
    if (currentSessionPeer !== sender_chat_pubkey) {
      session.unread++;
      console.log("[chat] 消息已标记为未读");
    }
    
    // 通知UI
    if (onNewMessage) {
      console.log("[chat] 通知UI显示新消息");
      onNewMessage({
        sessionId: sender_chat_pubkey,
        message: messageObj,
        unread: session.unread
      });
    }
  } catch (error) {
    // 解密失败处理
    console.debug("[chat] 消息处理失败:", error.message);
  }
}

//=================
// 会话管理
// ========================

export function switchSession(peerChatPubKey) {
  if (!sessions.has(peerChatPubKey)) {
    console.error("[chat] 会话不存在:", peerChatPubKey);
    return false;
  }
  
  currentSessionPeer = peerChatPubKey;
  
  // 通知UI会话已切换
  if (onSwitchSession) {
    onSwitchSession(peerChatPubKey);
  }
  
  return true;
}

export function getCurrentSession() {
  if (!currentSessionPeer) {
    return null;
  }
  return sessions.get(currentSessionPeer);
}

export function getSessions() {
  return Array.from(sessions.keys());
}

export function getSession(peerChatPubKey) {
  return sessions.get(peerChatPubKey);
}

// ========================  
// 发送消息
// ========================

export async function sendMessage(text) {
  if (!currentSessionPeer) {
    throw new Error("请先选择聊天对象");
  }
  
  const session = sessions.get(currentSessionPeer);
  if (!session) {
    throw new Error("会话不存在");
  }
  
  console.log("[chat] 发送消息到", currentSessionPeer.substring(0, 12) + "...");
  
  // 创建符合设计文档要求的消息结构
  const plaintext = {
    trade_id: currentTradeId,
    sender_pubkey: myChatPubKeyStr,
    content: text,
    message: text,  // 兼容旧版本
    timestamp: Date.now(),
    type: "CHAT"
  };
  
  // 使用AES-256-GCM加密消息
  console.log("[chat] 加密消息");
  const ciphertext = await encrypt(session.chatKey, plaintext);
  
  // 添加到本地消息历史
  const messageObj = {
    ...plaintext,
    isOwn: true
  };
  session.messages.push(messageObj);
  
  // 确定买家聊天公钥（用于服务器路由）
  const buyerChatPubKey = isSeller ? currentSessionPeer : myChatPubKeyStr;

  try {
    // 使用WebSocket发送加密消息
    sendChatTextMessage(JSON.stringify(ciphertext), myChatPubKeyStr, buyerChatPubKey);
    console.log("[chat] 消息发送成功");
    
    // 通知UI更新消息列表
    if (onNewMessage) {
      onNewMessage({
        sessionId: currentSessionPeer,
        message: messageObj,
        unread: 0
      });
    }
    
    return true;
  } catch (error) {
    console.error("[chat] 发送消息失败:", error);
    throw error;
  }
}

// 会话管理功能已在文件上方实现

export function listSessions() {
  return Array.from(sessions.entries()).map(([chatPubKey, session]) => ({
    chatPubKey,
    fingerprint: generateFingerprint(chatPubKey),
    unread: session.unread,
    lastMessage: session.messages[session.messages.length - 1]
  }));
}

// getCurrentSession 函数已在文件上方实现

export function getSessionMessages(chatPubKey) {
  const session = sessions.get(chatPubKey);
  return session ? session.messages : [];
}

// ========================
// 清理
// ========================

export function closeChat() {
  closeChatSocket();
  currentTradeId = null;
  identity = null;
  chatKeyPair = null;
  myChatPubKeyStr = null;
  sessions.clear();
  currentSessionPeer = null;
}

//检查聊天状态
export function isChatConnected() {
  return !!socket;
}