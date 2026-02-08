/**
 * keymgr.js
 *
 * 身份 / 密钥管理（用户显式操作）
 *
 * 设计原则：
 * - 所有危险操作都需要用户确认
 * - 不自动生成、不后台替换
 * - 不向其他模块暴露私钥
 */

import {
  generateIdentityKeyPair,
  saveIdentityKeyPair,
  loadIdentityKeyPair,
  exportIdentityKeyPair,
  importIdentityKeyPair,
  fingerprintPublicKey,
} from "./crypto.js";

/* =========================================================
 * 生成新身份（覆盖）
 * ========================================================= */

export async function generateNewIdentity() {
  const ok = confirm(
    "这将生成一套新的身份密钥，并覆盖当前身份。\n\n" +
      "⚠️ 如果你没有备份旧密钥，将永久失去之前的交易与身份。\n\n" +
      "是否继续？"
  );
  if (!ok) return;

  const kp = await generateIdentityKeyPair();
  await saveIdentityKeyPair(kp);

  alert("✅ 新身份已生成，请立即导出并备份你的密钥。");
}

/* =========================================================
 * 导出身份（JSON 文本）
 * ========================================================= */

export async function exportIdentity() {
  const kp = await loadIdentityKeyPair();
  if (!kp) {
    alert("当前没有身份密钥");
    return;
  }

  const text = exportIdentityKeyPair(kp);
  downloadText("identity-key.json", text);

  alert(" 身份已导出，请妥善保存该文件。");
}

/* =========================================================
 * 从文本导入身份
 * ========================================================= */

export async function importIdentityFromPrompt() {
  const text = prompt(
    "请粘贴之前导出的身份密钥（JSON 文本）："
  );
  if (!text) return;

  try {
    const kp = importIdentityKeyPair(text);

    const ok = confirm(
      "即将导入新的身份并覆盖当前身份。\n\n" +
        "是否确认继续？"
    );
    if (!ok) return;

    await saveIdentityKeyPair(kp);
    alert("✅ 身份导入成功");
  } catch (e) {
    alert("❌ 导入失败：" + e.message);
  }
}

/* =========================================================
 * 显示当前身份指纹
 * ========================================================= */

export async function showCurrentFingerprint() {
  const kp = await loadIdentityKeyPair();
  if (!kp) {
    alert("当前没有身份密钥");
    return;
  }

  const fp = await fingerprintPublicKey(kp.publicKey);
  alert("你的身份指纹：\n\n" + fp);
}

/* =========================================================
 * 工具：下载文本文件
 * ========================================================= */

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();

  URL.revokeObjectURL(url);
}
