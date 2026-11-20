// 环境切换：local = 本机调试；server = 阿里云轻量服务器直连（开发期）；prod = 备案 HTTPS 域名（上线）
const ENV = 'local';

const BASE = {
  local: 'http://127.0.0.1:3000',
  server: 'http://8.148.93.37:3000',
  prod: 'https://replace-with-your-icp-domain.example.com'
}[ENV];

module.exports = {
  ENV,
  API_BASE: BASE,
  // 正式小程序后台申请到的订阅消息模板 ID；留空时走开发模式模拟授权
  TEMPLATE_ID: 'qgTQLzahrFDwvcBITaJ3J0DroH5vyDOrthe9X2dwvX8',
  VERSION: '1.0.0'
};