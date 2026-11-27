// 环境切换：local = 本机调试；server = 服务器联调；prod = 正式 HTTPS 域名（上线）
// 注意：后端只监听 127.0.0.1:3000，外部不要直连 :3000，必须走 nginx 的 443。
// 证书只覆盖 www.bigshuai.xyz，不带 www 的主域名会报证书不受信任。
const ENV = 'prod';

const BASE = {
  local: 'http://127.0.0.1:3000',
  server: 'https://www.bigshuai.xyz',
  prod: 'https://www.bigshuai.xyz'
}[ENV];

module.exports = {
  ENV,
  API_BASE: BASE,
  // 正式小程序后台申请到的订阅消息模板 ID；留空时走开发模式模拟授权
  TEMPLATE_ID: 'qgTQLzahrFDwvcBITaJ3J0DroH5vyDOrthe9X2dwvX8',
  VERSION: '1.0.0'
};