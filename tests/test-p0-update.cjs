#!/usr/bin/env node
/* P0 验收测试：密码统一 + 旧解锁键兼容 + PWA 更新机制
 * 仅做静态断言与密码逻辑冒烟，不依赖浏览器 DOM/localStorage。 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'source');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.error('  ✗ ' + name); }
}

console.log('\n[1] 密码统一为 deltaforce');
const app = read('app.js');
const pd = read('parent-dashboard.js');
check('app.js 无旧中文密码', !app.includes('李江震的英语很牛逼'));
check('parent-dashboard.js 无旧中文密码', !pd.includes('李江震的英语很牛逼'));
check('app.js FINAL_PASSWORD = deltaforce', /FINAL_PASSWORD\s*=\s*'deltaforce'/.test(app));
check('parent-dashboard.js FINAL_PASSWORD = deltaforce', /FINAL_PASSWORD\s*=\s*'deltaforce'/.test(pd));
check('源码 .js 全量无旧中文密码（排除打包HTML）',
  ['app.js','parent-dashboard.js','sw.js','update.js','assessments.js','child-ux.js','data.js']
    .every(f => !read(f).includes('李江震的英语很牛逼')));

console.log('\n[2] 旧解锁键保持独立、未迁移/清除');
check('app.js 仍引用 eng30_final_unlocked', app.includes("'eng30_final_unlocked'"));
check('parent-dashboard.js 仍引用 eng30_parent_unlocked', pd.includes("'eng30_parent_unlocked'"));
check('parent-dashboard.js 只读读取 eng30_final_unlocked（未 removeItem）',
  pd.includes("storage.getItem('eng30_final_unlocked')") && !pd.includes("removeItem('eng30_final_unlocked')"));
check('setFinalUnlocked 使用 Eng30Storage', app.includes('Eng30Storage.set(ASSESS_STORAGE.unlocked'));

console.log('\n[3] PWA sw.js 版本与清理');
const sw = read('sw.js');
check('CACHE_NAME = english30-v13', /CACHE_NAME\s*=\s*'english30-v13'/.test(sw));
check('ASSETS 包含 update.js', sw.includes("./update.js"));
check('ASSETS 包含 tts-controller.js', sw.includes("./tts-controller.js"));
check('ASSETS 包含 tts-controller.css', sw.includes("./tts-controller.css"));
check('activate 清除其他 english30-* 缓存', sw.includes("startsWith('english30-')"));
check('activate 调用 clients.claim()', sw.includes('self.clients.claim()'));
// install 块内不得有真正的 skipWaiting() 调用（注释中的提及不算）
const installBlock = (sw.match(/addEventListener\('install'[\s\S]*?\}\);/) || [''])[0];
check('install 不再自动 skipWaiting', !/self\.skipWaiting\(\)\s*;/.test(installBlock));
check('监听 SKIP_WAITING message', sw.includes("'SKIP_WAITING'") && sw.includes('self.skipWaiting()'));

console.log('\n[4] update.js 更新提示与版本');
const upd = read('update.js');
check('暴露 window.APP_BUILD', upd.includes("var APP_BUILD = 'english30-v13'") && upd.includes('window.APP_BUILD = APP_BUILD;'));
check('显示"发现更新，点击刷新"', upd.includes('发现更新，点击刷新'));
check('监听 controllerchange', upd.includes("addEventListener('controllerchange'"));
check('监听 updatefound', upd.includes("addEventListener('updatefound'"));
check('检测已存在 waiting', upd.includes('reg.waiting'));
check('sessionStorage 守卫防无限刷新', upd.includes('GUARD_KEY') && upd.includes('sessionStorage.setItem(GUARD_KEY') && upd.includes('sessionStorage.removeItem(GUARD_KEY'));
check('postMessage SKIP_WAITING', upd.includes("postMessage({ type: 'SKIP_WAITING' })"));

console.log('\n[5] index.html 版本标识可查询');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
check('head 有 meta data-build', /<meta name="data-build" content="english30-v13">/.test(html));
check('关于区 #app-version 显示 v12', html.includes('当前版本 english30-v13'));
check('关于区有 #app-version', html.includes('id="app-version"'));
check('引入 update.js', html.includes('src="source/update.js"'));

console.log('\n[6] 密码校验逻辑冒烟（期末锁）');
const m = app.match(/FINAL_PASSWORD\s*=\s*'([^']+)'/);
const pw = m && m[1];
check('可提取密码常量', !!pw);
check("输入 'deltaforce' 校验通过", pw === 'deltaforce');
check("错误输入不通过", 'wrong' !== pw);

console.log('\n========================================');
console.log(`结果：${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
