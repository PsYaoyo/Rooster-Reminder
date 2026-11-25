'use strict';
// Manually fire a real WeChat subscribe message to verify template/config wiring.
// Usage on the server:
//   cd /opt/rooster/server
//   node --env-file=../.env test-push.js [openid]
// If openid is omitted, all known users are listed so you can pick one.
require('./src/bootstrap');
const config = require('./src/config');
const { db } = require('./src/db');
const wx = require('./src/wx');
const { fmtDate, fmtTime } = require('./src/schedule');

async function main() {
  console.log('=== 配置检查 ===');
  console.log('  devMode           :', config.devMode);
  console.log('  WX_APPID          :', config.wxAppId || '(空)');
  console.log('  WX_TEMPLATE_ID    :', config.wxTemplateId || '(空)');
  console.log('  miniprogram_state :', config.wxMiniProgramState);
  if (config.devMode) {
    console.error('\n当前是开发模式（无微信凭据），不会真实下发。请在服务器用正式 .env 启动。');
    process.exit(1);
  }
  if (!config.wxTemplateId) {
    console.error('\n未配置 WX_TEMPLATE_ID。');
    process.exit(1);
  }

  const users = db.prepare('SELECT openid, nickname FROM users ORDER BY created_at DESC').all();
  if (!users.length) {
    console.error('\n数据库里还没有用户，先用小程序真机登录一次。');
    process.exit(1);
  }
  let openid = process.argv[2];
  if (!openid) {
    if (users.length === 1) openid = users[0].openid;
    else {
      console.log('\n请选择 openid（把对应值作为命令行参数传入）：');
      users.forEach((u, i) => console.log(`  [${i}] ${u.openid}  ${u.nickname || ''}`));
      process.exit(0);
    }
  }
  const u = users.find((x) => x.openid === openid);
  console.log('\n=== 发送测试消息 ===');
  console.log('  目标 openid :', openid, u ? `(${u.nickname || '无昵称'})` : '(库中未找到，仍尝试发送)');
  console.log('  sub_quota   :', u ? u.sub_quota : '?');

  const now = Date.now();
  const data = {
    thing1: { value: '订阅消息测试'.slice(0, 20) },
    time2: { value: `${fmtDate(now)} ${fmtTime(now)}` },
    thing3: { value: '这是一条服务端测试消息'.slice(0, 20) }
  };
  try {
    const res = await wx.sendSubscribe(openid, { templateId: config.wxTemplateId, data });
    console.log('\n微信返回:', JSON.stringify(res));
    if (res.errcode === 0) console.log('✅ 下发成功，模板字段与凭据均正确。请到微信「服务通知」查看。');
    else if (res.errcode === 43101) console.log('⚠️ 43101 = 该用户没有有效订阅额度。需用真机重新授权订阅后再测。');
    else console.log('❌ 其他错误：检查模板 ID、字段 key、access_token 或 openid 是否属于本 appid。');
  } catch (e) {
    console.error('\n请求异常:', e.message);
  } finally {
    db.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
