/* ============================================================
 * update.js — PWA 更新检测与非阻塞刷新提示
 *
 * 版本标识（便于线上验证当前构建）：
 *   - window.APP_BUILD        控制台可直接查询
 *   - <meta name="data-build"> index.html <head> 中同步
 *   - 设置 → 关于 → "当前版本" 一行由本脚本填充
 *   与 sw.js 的 CACHE_NAME 保持一致。
 *
 * 流程：
 *   1) 注册 sw.js；监听 updatefound / 已存在的 waiting。
 *   2) 检测到新 SW 且页面已被旧 SW 控制时，底部显示非阻塞条
 *      "发现更新，点击刷新"（不自动刷新、不打断用户）。
 *   3) 用户点击刷新 → 写入 sessionStorage 守卫 → postMessage
 *      SKIP_WAITING 给等待中的 SW。
 *   4) 新 SW 激活触发 controllerchange → 守卫命中时 reload 一次并清守卫，
 *      拿到最新缓存资源；守卫保证同一会话只刷新一次，避免无限刷新。
 * ============================================================ */
(function () {
  'use strict';

  var APP_BUILD = 'english30-v13';
  window.APP_BUILD = APP_BUILD;

  // 设置-关于 版本展示
  try {
    var vEl = document.getElementById('app-version');
    if (vEl) vEl.textContent = '当前版本 ' + APP_BUILD;
  } catch (e) { /* 无此节点忽略 */ }

  if (!('serviceWorker' in navigator)) return;

  // sessionStorage 守卫：标记"本会话是否已为更新触发过一次刷新"
  var GUARD_KEY = 'eng30_update_refreshed';

  // 注入提示条样式（非阻塞、固定底部）
  function injectStyles() {
    if (document.getElementById('sw-update-style')) return;
    var style = document.createElement('style');
    style.id = 'sw-update-style';
    style.textContent =
      '.sw-update-bar{position:fixed;left:12px;right:12px;' +
      'bottom:calc(12px + env(safe-area-inset-bottom, 0px));z-index:99999;' +
      'display:flex;align-items:center;justify-content:space-between;gap:12px;' +
      'background:#2b2b2b;color:#fff;padding:10px 14px;border-radius:12px;' +
      'box-shadow:0 4px 16px rgba(0,0,0,.28);font-size:14px;}' +
      '.sw-update-txt{flex:1;line-height:1.3;}' +
      '.sw-update-btn{flex:none;border:none;border-radius:8px;background:#E8734A;' +
      'color:#fff;font-size:14px;font-weight:600;padding:8px 16px;cursor:pointer;}';
    document.head.appendChild(style);
  }

  function ensureBar() {
    var bar = document.getElementById('sw-update-bar');
    if (bar) return bar;
    injectStyles();
    bar = document.createElement('div');
    bar.id = 'sw-update-bar';
    bar.className = 'sw-update-bar';
    bar.innerHTML =
      '<span class="sw-update-txt">发现更新，点击刷新</span>' +
      '<button type="button" class="sw-update-btn">刷新</button>';
    document.body.appendChild(bar);
    bar.querySelector('.sw-update-btn').addEventListener('click', function () {
      try { sessionStorage.setItem(GUARD_KEY, '1'); } catch (e) {}
      navigator.serviceWorker.getRegistration().then(function (reg) {
        if (reg && reg.waiting) {
          // 通知等待中的 SW 立即激活
          reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        } else {
          // 没有等待中的 SW，直接刷新一次
          location.reload();
        }
      }).catch(function () { location.reload(); });
    });
    return bar;
  }

  function promptUpdate() {
    // 本会话已经因更新刷新过一次，不再重复提示，避免循环
    try { if (sessionStorage.getItem(GUARD_KEY) === '1') return; } catch (e) {}
    ensureBar();
  }

  // 新 SW 接管后：若是用户经本提示触发的刷新，则重载一次以加载最新缓存资源
  navigator.serviceWorker.addEventListener('controllerchange', function () {
    try {
      if (sessionStorage.getItem(GUARD_KEY) === '1') {
        sessionStorage.removeItem(GUARD_KEY);
        location.reload();
      }
    } catch (e) {
      location.reload();
    }
  });

  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js', { scope: './' }).then(function (reg) {
      // 已有等待中的新 SW（上次安装好但尚未激活）
      if (reg.waiting && navigator.serviceWorker.controller) {
        promptUpdate();
      }
      // 本次注册过程中发现新版本
      reg.addEventListener('updatefound', function () {
        var installing = reg.installing;
        if (!installing) return;
        installing.addEventListener('statechange', function () {
          // installed 且已有旧 controller 在用 → 属于"有更新"，提示
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            promptUpdate();
          }
        });
      });
    }).catch(function () { /* 离线 / 不支持时静默，不影响使用 */ });
  });
})();
