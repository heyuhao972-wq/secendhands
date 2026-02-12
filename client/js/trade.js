/**

 *  交易流程编排（create / complete / cancel）
 *  交易相关页面初始化（index / publish / trade）
 *
 * 
 *  读取 input
 *  写入 div
 *
 */

import {
  loadIdentityKeyPair,
  hash,
  sign,
  verify,
} from "./crypto.js";

import {
  fetchTradeList,
  getTrade,
  createTrade,
  joinTrade,
  completeTrade,
  cancelTrade as apiCancelTrade,
  exportBlocks as apiExportBlocks,
} from "./api.js";

import * as chat from "./chat.js";

import { saveTradeMeta } from "./trade_meta.js";


let currentTradeId = null;
let currentTrade = null;
let currentIdentity = null;

/*=======================
 * 一、纯交易逻辑
   =====================*/

export async function publishTrade(tradeContent) {
  console.log("[trade] 开始发布交易");
  
  // 加载用户身份密钥对
  console.log("[trade] 加载用户身份密钥对");
  const { publicKey, privateKey } = await loadIdentityKeyPair();
  const timestamp = Math.floor(Date.now() / 1000);

  // 计算交易内容的哈希值
  console.log("[trade] 计算交易内容哈希");
  const contentHash = await hash(tradeContent);

  // 保存交易元数据到本地存储
  saveTradeMeta(contentHash, {
    description: tradeContent.description,
    price: tradeContent.price,
  });

  // 创建交易主体数据
  const body = {
    trade_id: null,
    seller_pubkey: publicKey,
    content_hash: contentHash,
    description: tradeContent.description,
    price: tradeContent.price,
    timestamp,
  };

  // 计算交易ID
  console.log("[trade] 计算交易ID");
  const tradeId = await hash(body);
  body.trade_id = tradeId;

  // 对交易ID进行签名
  console.log("[trade] 对交易ID进行签名");
  const signature = await sign(tradeId, privateKey);

  // 发送创建交易请求到服务器
  console.log("[trade] 发送创建交易请求");
  await createTrade({ trade_id: tradeId, body, signature });
  
  console.log("[trade] 交易发布成功，交易ID:", tradeId);
  return tradeId;
}

export async function signComplete(tradeId) {
  console.log("[trade] 开始对交易完成进行签名，交易ID:", tradeId);
  
  const { publicKey, privateKey } = await loadIdentityKeyPair();

  // 创建交易完成的主体数据
  const body = {
    trade_id: tradeId,
    result: "COMPLETED",
    timestamp: Math.floor(Date.now() / 1000),
  };

  // 计算交易完成数据的哈希值
  console.log("[trade] 计算交易完成数据哈希");
  const completeHash = await hash(body);
  
  // 对哈希值进行签名
  console.log("[trade] 对交易完成哈希进行签名");
  const signature = await sign(completeHash, privateKey);

  console.log("[trade] 签名完成");
  return { 
    hash: completeHash, 
    signature, 
    pubkey: publicKey,
    body // 包含body
  };
}

export async function submitComplete(tradeId, sigA, sigB) {
  console.log("[trade] 开始提交交易完成请求，交易ID:", tradeId);
  
  // 验证本地哈希与签名哈希是否一致
  console.log("[trade] 验证本地哈希一致");
  const localHash = await hash(sigA.body);
  if (localHash !== sigA.hash) {
    throw new Error("本地计算的哈希与签名的哈希不一致");
  }

  // 验证双方签名的哈希是否一致
  console.log("[trade] 验证双方哈希一致");
  if (sigA.hash !== sigB.hash) {
    throw new Error("双方签名的哈希不一致");
  }

  // 验证双方签名的有效性
  console.log("[trade] 验证双方签名有效");
  if (
    !(await verify(sigA.hash, sigA.signature, sigA.pubkey)) ||
    !(await verify(sigB.hash, sigB.signature, sigB.pubkey))
  ) {
    throw new Error("无效的签名");
  }

  // 提交交易完成请求到服务器
  console.log("[trade] 提交交易完成请求到服务器");
  await completeTrade({
    trade_id: tradeId,
    hash: sigA.hash,
    sig_seller: sigA.signature,
    sig_buyer: sigB.signature,
  });
  
  console.log("[trade] 交易完成请求提交成功");
}

export async function cancelTrade(tradeId) {
  console.log("[trade] 开始取消交易，交易ID:", tradeId);
  
  const { privateKey } = await loadIdentityKeyPair();

  // 创建交易取消的主体数据
  const body = {
    trade_id: tradeId,
    result: "CANCELLED",
    timestamp: Math.floor(Date.now() / 1000),
  };

  // 计算交易取消数据的哈希
  console.log("[trade] 计算交易取消数据哈希");
  const cancelHash = await hash(body);
  
  // 对哈希值进行签名
  console.log("[trade] 对交易取消哈希进行签名");
  const signature = await sign(cancelHash, privateKey);

  // 发送交易取消请求到服务端
  console.log("[trade] 发送交易取消请求");
  await apiCancelTrade({
    trade_id: tradeId,
    hash: cancelHash,
    signature,
  });
  
  console.log("[trade] 交易取消请求发送成功");
}




import { loadTradeMeta } from "./trade_meta.js";

export async function initIndexPage() {
  let trades = await fetchTradeList();
  // 调试日志：获取交易列表结果
  console.log("[trade] 获取交易列表结果:", trades);


  const list = document.getElementById("trade-list");
  const empty = document.getElementById("trade-empty");

  // 清空列表
  list.innerHTML = "";


  try {
    trades = await fetchTradeList();
  } catch (e) {
    console.error("fetchTradeList failed", e);
    empty.style.display = "block";
    empty.textContent = "加载失败";
    return;
  }

  

  // 修复
  if (trades && trades.data) {
    trades = trades.data;
  }


  if (!Array.isArray(trades) || trades.length === 0) {
    empty.style.display = "block";
    empty.textContent = "暂无交易";
    return;
  }

  empty.style.display = "none";

  const metaMap = loadTradeMeta();

  for (const t of trades) {
    const li = document.createElement("li");
    li.className = "trade-item";

    const meta = metaMap[t.content_hash];
    const title = t.description ?? meta?.description ?? t.content_hash.slice(0, 12);
    const price = t.price ?? meta?.price ?? "";


    li.textContent = `${title} ${price} 状态:${t.status}`;

    li.onclick = () => {
      location.href = `trade.html?trade_id=${t.trade_id}`;
    };

    list.appendChild(li);
  }
}




/* 
 * 三、publish.html（发布交易）
   */

export async function publishTradeFromForm() {
  const content = {
    description: document.getElementById("desc").value,
    price: document.getElementById("price").value,
  };

  const tradeId = await publishTrade(content);
  location.href = `trade.html?trade_id=${tradeId}`;
}

/* 
 * 四、trade.html（交易详情+ 聊天)
   */


export async function initTradePage() {
  console.log("[trade] 开始初始化交易页面");
  
  // 获取交易ID
  const tradeId = new URLSearchParams(location.search).get("trade_id");
  if (!tradeId) {
    console.error("[trade] 缺少交易ID");
    document.getElementById("trade-info").textContent = "错误：缺少交易ID";
    return;
  }

  console.log("[trade] 交易ID:", tradeId);
  
  // 获取交易详情
  let trade = await getTrade(tradeId);

  const identity = await loadIdentityKeyPair();
  if (!identity) {
    alert('未找到身份信息，请先生成或导入身份');
    return;
  }
  const { publicKey } = identity;

  currentTradeId = tradeId;
  currentTrade = trade;
  currentIdentity = identity;

  // 显示基本信息
  document.getElementById("trade-info").textContent =
    `交易ID: ${trade.trade_id}\n状态: ${trade.status}`;

    //交易结束提示 
  if (trade.status === "COMPLETED" || trade.status === "CANCELLED") {
    showTradeEndedNotice(trade.status);
  }

  // 初始化聊天系统，设置UI回调
  console.log("[trade] 初始化聊天系统");
  await chat.initChat(tradeId, {
    onNewSession: handleNewSession,
    onNewMessage: handleNewMessage,
    onSwitchSession: handleSwitchSession
  });
  
  // 绑定发送按钮
  bindChatSend();

  /* ========= 我是卖家 ========= */
  if (trade.seller_pubkey === publicKey) {
    console.log("[trade] 用户身份：卖家");
    
    if (trade.buyer_pubkey) {
      console.log("[trade] 卖家聊天已初始化，买家已加入");
    } else {
      document.getElementById("trade-info").textContent += "\n等待买家加入";
      console.log("[trade] 聊天已初始化（等待买家）");
    }
  }

  /* ========= 操作者是买家 ========= */
  else {
    console.log("[trade] 用户身份：买家");
    console.log("[trade] 买家聊天已初始化");

    // 关键：操作者是买家，但还没加入交易
    if (!trade.buyer_pubkey) {
      console.log("[trade] 买家加入交易");

      await joinTrade(tradeId, {
        buyer_pubkey: publicKey, // 使用Ed25519公钥（身份公钥）
      });

      // 重新获取交易
      trade = await getTrade(tradeId);
    }
  }
  
  console.log("[trade] 交易页面初始化完成");
}

// 处理新会话创建时，标记为未读
function markSessionUnread(peerChatPubKey) {
  const selector = `.session-item[data-chat-pubkey="${peerChatPubKey}"]`;
  const item = document.querySelector(selector);
  if (!item) return;

  if (!item.classList.contains("unread")) {
    item.classList.add("unread");
  }

  let badge = item.querySelector(".unread-badge");
  if (!badge) {
    badge = document.createElement("span");
    badge.className = "unread-badge";
    badge.textContent = "未读";
    item.appendChild(badge);
  }
}

function clearSessionUnread(peerChatPubKey) {
  const selector = `.session-item[data-chat-pubkey="${peerChatPubKey}"]`;
  const item = document.querySelector(selector);
  if (!item) return;
  item.classList.remove("unread");
  const badge = item.querySelector(".unread-badge");
  if (badge) badge.remove();
}

function handleNewSession(sessionInfo) {
  const sessionsList = document.getElementById("chat-sessions");
  if (!sessionsList) {
    console.error("[trade] 无法找到 chat-sessions 元素");
    return;
  }
  
  const peerChatPubKey = sessionInfo.chatPubKey;
  const sessionItem = document.createElement("div");
  sessionItem.className = "session-item";
  
  // 确保peerChatPubKey是字符串
  const displayText = typeof peerChatPubKey === 'string' 
    ? peerChatPubKey.slice(0, 12) + "..." 
    : String(peerChatPubKey);
    
  sessionItem.textContent = displayText;
  sessionItem.dataset.chatPubkey = peerChatPubKey;
  sessionItem.onclick = () => {
    // 切换到该会话
    chat.switchSession(peerChatPubKey);
    
    // 更新UI，移除所有会话的active类
    document.querySelectorAll(".session-item").forEach(item => {
      item.classList.remove("active");
    });
    
    // 为当前选中的会话添加active类
    sessionItem.classList.add("active");
    clearSessionUnread(peerChatPubKey);
  };
  
  // 如果是第一个会话，自动切换到它
  if (sessionsList.children.length === 0) {
    chat.switchSession(peerChatPubKey);
    sessionItem.classList.add("active");
  }
  
  sessionsList.appendChild(sessionItem);
}

// 处理会话切换
function handleSwitchSession(peerChatPubKey) {
  console.log("[trade] 切换到会话:", peerChatPubKey);
  
  // 更新会话列表的active类
  document.querySelectorAll(".session-item").forEach(item => {
    item.classList.remove("active");
  });
  
  // 找到对应的会话项并添加active类
  const currentItem = document.querySelector(
    `.session-item[data-chat-pubkey="${peerChatPubKey}"]`
  );
  if (currentItem) {
    currentItem.classList.add("active");
  }
  clearSessionUnread(peerChatPubKey);
  
  renderChatMessages(peerChatPubKey);
}

// 处理新消息
async function handleNewMessage(payload) {
  const peerChatPubKey = payload?.sessionId;
  if (!peerChatPubKey) {
    return;
  }

    const rawMessage = payload?.message;
  const messageText = rawMessage?.content || rawMessage?.message;
  if (messageText && !rawMessage?.isOwn) {
    console.log("[trade] 收到新消息:", messageText);
    const handled = await tryHandleTradeCompleteRequest(messageText);
    if (handled) {
      return;
    }
  }

  
  // 渲染当前会话的消息
  if (chat.getCurrentSession()?.peerChatPubKey === peerChatPubKey) {
    renderChatMessages(peerChatPubKey);
  } else {
    // 非当前会话收到新消息，标记为未读
    markSessionUnread(peerChatPubKey);
  }
}


// 会话切换处理已在上方实现

// 渲染聊天消息
function renderChatMessages(peerChatPubKey) {
  const messagesContainer = document.getElementById("chat-messages");
  if (!messagesContainer) {
    console.error("[trade] 无法找到 chat-messages 元素");
    return;
  }
  
  messagesContainer.innerHTML = "";
  
  // 获取当前会话
  const session = chat.getSession(peerChatPubKey);
  if (!session) {
    return;
  }
  
  // 渲染消息
  session.messages.forEach(msg => {
    const messageDiv = document.createElement("div");
    messageDiv.className = "chat-message";
    
    // 判断是自己发送的还是对方发送的
    messageDiv.classList.add(msg.isOwn ? "own-message" : "other-message");
    
    // 显示消息内容
    messageDiv.textContent = msg.content;
    
    // 显示时间
    const timeSpan = document.createElement("span");
    timeSpan.className = "message-time";
    timeSpan.textContent = new Date(msg.timestamp).toLocaleTimeString();
    messageDiv.appendChild(timeSpan);
    
    messagesContainer.appendChild(messageDiv);
  });
  
  // 滚动到底部
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// 绑定发送按钮事件
function bindChatSend() {
  const sendBtn = document.getElementById("send-btn");
  const chatInput = document.getElementById("chat-input");
  
  sendBtn.onclick = async () => {
    const message = chatInput.value.trim();
    if (message) {
      await chat.sendMessage(message);
      chatInput.value = "";
    }
  };
  
  // 支持回车键发送消息
  chatInput.addEventListener("keypress", async (e) => {
    if (e.key === "Enter") {
      const message = chatInput.value.trim();
      if (message) {
        await chat.sendMessage(message);
        chatInput.value = "";
      }
    }
  });
}


/**
 * 尝试处理交易完成请求
 * @param {string|Object} messageText - 消息文本或对象
 * @returns {Promise<boolean>} 是否处理成功
 */
async function tryHandleTradeCompleteRequest(messageText) {
  let payload = null;

  if (messageText && typeof messageText === "object") {
    payload = messageText;
  } else {
    try {
      payload = JSON.parse(messageText);
    } catch (e) {
      return false;
    }
  }

  if (!payload || payload.type !== "TRADE_COMPLETE_REQUEST") {
    console.log("[trade] 不是完成请求");
    return false;
  }

  if (!currentTradeId || !currentTrade || !currentIdentity) {
    alert("当前交易信息未就绪，无法处理完成请求");
    return true;
  }

  const peerSig = payload.signature;
  if (!peerSig || !peerSig.body || !peerSig.hash || !peerSig.signature || !peerSig.pubkey) {
    alert("对方完成请求缺少签名字段");
    return true;
  }

  try {
    await verifyPeerSignature(peerSig.body, peerSig.hash, peerSig.signature, peerSig.pubkey);
  } catch (error) {
    alert("对方签名验证失败: " + error.message);
    return true;
  }

  // 只缓存，不提示
  window.__pendingPeerSig = peerSig;
  alert("对方已请求完成交易，请你点击\"确认完成\"以继续交易");
  return true;
}


export async function verifyPeerSignature(body, hash, signature, peerPubKey) {
  // 导入crypto模块
  const crypto = await import('./crypto.js');
  
  const localHash = await crypto.hash(body)

  if (localHash !== hash) {
    throw new Error("hash 不一致，疑似篡改")
  }

  // 校验对方签名
  const ok = await crypto.verify(hash, signature, peerPubKey)
  if (!ok) {
    throw new Error("对方签名无效")
  }
}

// 买家发起完成交易流程
export async function buyerInitiateCompleteTrade() {
  try {
    const tradeId = new URLSearchParams(location.search).get("trade_id");
    if (!tradeId) {
      throw new Error("缺少交易ID");
    }
    
    // 1. 买家生成自己的签名和交易body
    const mySignature = await signComplete(tradeId);
    
    // 2. 将交易信息和签名分享给卖家
    // 实际实现中，应该通过加密聊天系统发送给卖家
    const tradeInfo = {
      body: mySignature.body,
      hash: mySignature.hash,
      signature: mySignature.signature,
      pubkey: mySignature.pubkey
    };
    
    alert("请将以下交易信息发送给卖家：\n" + JSON.stringify(tradeInfo));
    alert("等待卖家确认并返回其签名");
    
  } catch (error) {
    console.error("买家发起完成交易失败:", error);
    alert("发起完成交易失败: " + error.message);
  }
}

// 卖家处理买家的交易完成请求
export async function sellerProcessCompleteTrade() {
  try {
    const tradeId = new URLSearchParams(location.search).get("trade_id");
    if (!tradeId) {
      throw new Error("缺少交易ID");
    }
    
    // 1. 卖家获取买家发送的交易信息
    const buyerTradeInfo = prompt("请输入买家发送的交易信息（JSON格式）：");
    if (!buyerTradeInfo) {
      alert("未提供买家交易信息，处理失败");
      return;
    }
    
    const buyerSig = JSON.parse(buyerTradeInfo);
    
    // 2. 卖家校验买家签名的有效性
    try {
      await verifyPeerSignature(buyerSig.body, buyerSig.hash, buyerSig.signature, buyerSig.pubkey);
      alert("买家签名验证通过");
    } catch (error) {
      alert("买家签名验证失败: " + error.message);
      return;
    }
    
    // 3. 卖家对相同的body进行签名
    // 生成与买家相同body的签名
    const sellerSig = await signCompleteWithBody(buyerSig.body);
    
    // 4. 将卖家签名发送给买家
    alert("请将以下卖家签名信息发送给买家：\n" + JSON.stringify(sellerSig));
    
  } catch (error) {
    console.error("卖家处理交易完成请求失败:", error);
    alert("处理交易完成请求失败: " + error.message);
  }
}

// 使用指定的body生成签名（用于卖家对买家的body进行签名）
export async function signCompleteWithBody(body) {
  const { publicKey, privateKey } = await loadIdentityKeyPair();
  
  // 计算与买家相同body的hash
  const completeHash = await hash(body);
  // 用卖家的私钥签名
  const signature = await sign(completeHash, privateKey);
  
  return { hash: completeHash, signature, pubkey: publicKey, body };
}

// 提交双方签名完成交易
export async function submitBothSignatures(tradeId, buyerSig, sellerSig) {
  try {
    // 验证双方签名和hash的一致性
    await verifyPeerSignature(buyerSig.body, buyerSig.hash, buyerSig.signature, buyerSig.pubkey);
    await verifyPeerSignature(sellerSig.body, sellerSig.hash, sellerSig.signature, sellerSig.pubkey);
    
    // 提交完成交易
    await submitComplete(tradeId,  sellerSig, buyerSig);
    
    alert("交易完成请求已提交，交易状态将更新为已完成");
    location.reload();
  } catch (error) {
    console.error("提交双方签名失败:", error);
    alert("提交双方签名失败: " + error.message);
  }
}

// 确认完成交易的统一入口
export async function confirmCompleteTrade() {
  try {
    const tradeId = new URLSearchParams(location.search).get("trade_id");
    if (!tradeId) {
      throw new Error("缺少交易ID");
    }

    // 获取当前交易信息和身份信息
    const trade = await getTrade(tradeId);
    const identity = await loadIdentityKeyPair();

    if (!trade || !identity) {
      alert("无法获取交易信息或身份信息，确认失败");
      return;
    }

    // 检查聊天连接状态
    const currentSession = chat.getCurrentSession();
    if (!currentSession) {
      alert("请先选择聊天对象");
      return;
    }

    if (!chat.isChatConnected()) {
      alert("聊天连接尚未建立，请稍后再试");
      return;
    }

    const pendingPeerSig = window.__pendingPeerSig;

    //  如果没有对方请求，只发送自己的请求
    if (!pendingPeerSig) {
      const signature = await signComplete(tradeId);
      const completeRequest = {
        type: "TRADE_COMPLETE_REQUEST",
        trade_id: tradeId,
        signature: signature
      };
      await chat.sendMessage(JSON.stringify(completeRequest));
      alert("交易完成请求已发送，请等待对方确认");
      return;
    }

    //  如果有对方请求，生成自己签名并提交
    const mySig = await signCompleteWithBody(pendingPeerSig.body);

    let buyerSig = null;
    let sellerSig = null;

    if (pendingPeerSig.pubkey === trade.seller_pubkey) {
      sellerSig = pendingPeerSig;
      buyerSig = mySig;
    } else if (pendingPeerSig.pubkey === trade.buyer_pubkey) {
      buyerSig = pendingPeerSig;
      sellerSig = mySig;
    } else if (identity.publicKey === trade.seller_pubkey) {
      sellerSig = mySig;
      buyerSig = pendingPeerSig;
    } else if (identity.publicKey === trade.buyer_pubkey) {
      buyerSig = mySig;
      sellerSig = pendingPeerSig;
    } else {
      throw new Error("无法确定买家/卖家签名归属");
    }

    await submitBothSignatures(tradeId, buyerSig, sellerSig);
    window.__pendingPeerSig = null;

  } catch (error) {
    console.error("确认完成交易失败:", error);
    alert("确认完成交易失败: " + error.message);
  }
}



// 取消当前交易的入口函数
export async function cancelCurrentTrade() {
  try {
    const tradeId = new URLSearchParams(location.search).get("trade_id");
    if (!tradeId) {
      throw new Error("缺少交易ID");
    }
    
    if (!confirm("确定要取消此交易吗？此操作不可撤销")) {
      return;
    }
    
    // 调用取消交易函数
    await cancelTrade(tradeId);
    
    alert("交易取消请求已提交，交易状态将更新为已取消");
    // 刷新页面以显示最新状态
    location.reload();
  } catch (error) {
    console.error("取消交易失败:", error);
    alert("取消交易失败: " + error.message);
  }
}

export async function exportBlocksToFile() {
  try {
    const data = await apiExportBlocks();
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "blocks-export.json";
    a.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error("[trade] 导出区块链失败:", error);
    alert("导出区块链失败: " + error.message);
  }
}
//交易完成用户提示
function showTradeEndedNotice(status) {
  const notice = document.createElement("div");

  notice.style.backgroundColor = "#fff3cd";
  notice.style.color = "#856404";
  notice.style.padding = "12px";
  notice.style.marginBottom = "15px";
  notice.style.border = "1px solid #ffeeba";
  notice.style.borderRadius = "6px";
  notice.style.fontWeight = "bold";

  notice.textContent =
    status === "COMPLETED"
      ? "交易已完成，记录已上链，所有更改将不被记录"
      : "交易已取消，所有更改将不被记录";

  const tradeInfo = document.getElementById("trade-info");
  tradeInfo.parentNode.insertBefore(notice, tradeInfo);

  // 禁用输入框和发送按钮
  const input = document.getElementById("chat-input");
  const sendBtn = document.getElementById("send-button");
  const completeBtn = document.getElementById("completeBtn"); // 使用 id 来获取按钮
  const cancelBtn = document.getElementById("cancelBtn"); // 使用 id 来获取按钮

  if (input) input.disabled = true;
  if (sendBtn) sendBtn.disabled = true;

  if (completeBtn) {
    completeBtn.disabled = true;
    completeBtn.style.opacity = "0.6";  // 让按钮显示禁用状态
    completeBtn.style.cursor = "not-allowed";
  }

  if (cancelBtn) {
    cancelBtn.disabled = true;
    cancelBtn.style.opacity = "0.6";  // 让按钮显示禁用状态
    cancelBtn.style.cursor = "not-allowed";
  }

  console.log("[trade] 已禁用取消和确认完成按钮（交易已结束）");
}