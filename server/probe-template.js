'use strict';
// Discover the active subscribe template's real field keys.
// WeChat rejects 47003 before sending, so only the final correct call actually
// delivers a message. Each error names the next missing field, so we fill them
// one by one until the send succeeds.
require('./src/bootstrap');
const config = require('./src/config');
const { db } = require('./src/db');
const wx = require('./src/wx');

function sampleValue(key) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  if (/^(time|date)/i.test(key)) return { value: stamp };
  if (/^number/i.test(key)) return { value: 1 };
  if (/^(phrase|first)/i.test(key)) return { value: '测试' };
  return { value: '测试内容' }; // thing / 备注 / 事项
}

async function main() {
  if (config.devMode) {
    console.error('需要生产 .env（含 WX_APPID/WX_SECRET/WX_TEMPLATE_ID）');
    process.exit(1);
  }
  const users = db.prepare('SELECT openid, nickname FROM users ORDER BY created_at DESC').all();
  if (!users.length) {
    console.error('数据库里没有用户，先用小程序真机登录一次');
    process.exit(1);
  }
  let openid = process.argv[2];
  if (!openid) {
    if (users.length === 1) openid = users[0].openid;
    else {
      console.log('选择一个 openid，把值作为命令行参数传入：');
      users.forEach((u, i) => console.log(`  [${i}] ${u.openid}  ${u.nickname || ''}`));
      process.exit(0);
    }
  }

  const templateId = config.wxTemplateId;
  console.log('=== 探测模板字段 ===');
  console.log('模板 ID :', templateId);
  console.log('目标     :', openid);
  const data = {};
  for (let i = 1; i <= 12; i++) {
    let res;
    try {
      res = await wx.sendSubscribe(openid, { templateId, data });
    } catch (e) {
      console.error(`第 ${i} 次请求异常:`, e.message);
      break;
    }
    console.log(`第 ${i} 次:`, JSON.stringify(res));
    if (res.errcode === 0) {
      console.log('\n✅ 成功。字段 key 顺序：', Object.keys(data).join(', '));
      console.log('把 server/src/push.js 里的 data 映射改成这些 key 即可。');
      break;
    }
    if (res.errcode !== 47003) {
      console.log('\n❌ 非字段错误，停止。请检查上面的 errmsg。');
      break;
    }
    const m = String(res.errmsg || '').match(/data\.([A-Za-z0-9_]+)\.value is empty/);
    if (!m) {
      console.log('\n❌ 无法从 errmsg 解析缺失字段:', res.errmsg);
      break;
    }
    const key = m[1];
    data[key] = sampleValue(key);
    console.log(`   → 补字段 ${key} = ${JSON.stringify(data[key].value)}`);
  }
  db.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
