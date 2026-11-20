'use strict';
// WeChat mini program CI upload / preview without DevTools.
// Requires a code-upload private key downloaded from:
//   微信公众平台 → 开发管理 → 开发设置 → 小程序代码上传
// Save it as tools/private.key (already gitignored via *.key), or point
// WX_PRIVATE_KEY_PATH at it. Configure the IP whitelist in the same page if enabled.
const fs = require('fs');
const path = require('path');
const ci = require('miniprogram-ci');

const ROOT = path.join(__dirname, '..');
const projectConfig = require('../project.config.json');
const appConfig = require('../miniprogram/config');

const argv = process.argv.slice(2);
const isPreview = argv.includes('--preview');
const positional = argv.filter((a) => !a.startsWith('--'));
const keyPath = process.env.WX_PRIVATE_KEY_PATH || path.join(__dirname, 'private.key');

if (!fs.existsSync(keyPath)) {
  console.error(`[ci] 未找到代码上传密钥: ${keyPath}`);
  console.error('[ci] 请先到 微信公众平台 → 开发管理 → 开发设置 → 小程序代码上传 下载密钥，');
  console.error('     保存为 tools/private.key，或设置 WX_PRIVATE_KEY_PATH 指向该文件。');
  process.exit(1);
}

const project = new ci.Project({
  appid: projectConfig.appid,
  type: 'miniProgram',
  projectPath: ROOT,
  privateKeyPath: keyPath,
  ignores: [
    'node_modules/**/*',
    'tools/**/*',
    'server/**/*',
    'deploy/**/*',
    'scripts/**/*',
    'preview/**/*',
    '.git/**/*',
    '.workbuddy/**/*'
  ]
});

const setting = {
  es6: true,
  enhance: true,
  postcss: true,
  minified: true
};

const robot = process.env.CI_ROBOT ? Number(process.env.CI_ROBOT) : undefined;
if (robot !== undefined && (!Number.isInteger(robot) || robot < 1 || robot > 30)) {
  console.error('[ci] CI_ROBOT 必须是 1~30 的整数');
  process.exit(1);
}

const version = positional[0] || process.env.CI_VERSION || appConfig.VERSION;
const desc = positional[1] || process.env.CI_DESC || 'Rooster Reminder CI upload';
const qrcodeOutputDest = positional[0] || process.env.CI_QRCODE || path.join(__dirname, 'preview-qr.jpg');

(async () => {
  try {
    if (isPreview) {
      const result = await ci.preview({
        project,
        desc,
        setting,
        qrcodeFormat: 'image',
        qrcodeOutputDest,
        pagePath: 'pages/index/index',
        onProgressUpdate: (msg) => console.log('[ci]', msg)
      });
      console.log(`[ci] 预览二维码已生成: ${qrcodeOutputDest}`);
      console.log(result);
    } else {
      const result = await ci.upload({
        project,
        version,
        desc,
        setting,
        robot,
        onProgressUpdate: (msg) => console.log('[ci]', msg)
      });
      console.log(`[ci] 上传成功 version=${version} desc=${desc}`);
      console.log(result);
    }
  } catch (e) {
    console.error('[ci] 失败:', e && e.message ? e.message : e);
    process.exitCode = 1;
  }
})();
