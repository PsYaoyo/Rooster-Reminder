# 部署与上线指南 · Rooster Reminder 雄鸡提醒器

目标服务器：阿里云轻量应用服务器 **Ubuntu 24.04 · 2 vCPU / 2 GiB / 40 GiB · 公网 IP `8.148.93.37`**（华中1 武汉）。
后端只依赖 Node.js ≥ 22.5 内置 `node:sqlite` + Express，无原生编译依赖，2C2G 足够。

进程模型：`pm2 (node src/index.js, 127.0.0.1:3000)` ← `nginx (80/443)` ← 微信小程序 request 合法域名。
数据：`/opt/rooster/server/data/rooster.db`（WAL），每日 03:30 `VACUUM INTO` 热备份，保留 14 天。

---

## 0. 上传代码（本机 Git Bash / PowerShell）

```bash
cd "D:/02File/Rooster Reminder"
scp -r server deploy root@8.148.93.37:/root/rooster-src
```

> 只需 `server/` 与 `deploy/`。`miniprogram/` 留在本机用微信开发者工具上传，不进服务器。
> 若 ssh 端口非 22：`scp -P <port> ...`。首次登录密码在阿里云控制台「远程连接 / 重置密码」获取。

## 1. 一键 provisioning（服务器上）

```bash
ssh root@8.148.93.37
cd /root/rooster-src && bash deploy/setup.sh
```

脚本依次完成：apt 基础包 → NodeSource Node 22 → pm2 → 同步代码到 `/opt/rooster` →
`npm install --omit=dev`（npmmirror 源）→ 生成 `/opt/rooster/.env`（随机 `AUTH_SECRET`、`HOST=127.0.0.1`、`SEED_DEMO=false`）→
pm2 启动 + 开机自启 → nginx 反代（80）→ ufw 只放行 22/80/443 → 备份 cron → `curl /api/health` 冒烟。

验证：

```bash
curl http://127.0.0.1:3000/api/health     # {"ok":true,...}
curl http://8.148.93.37/api/health        # 经 nginx，同样返回 ok
pm2 status && pm2 logs rooster-server --lines 50
```

此时可用 `http://8.148.93.37` 作为**开发期**后端：开发者工具勾选「不校验合法域名」，
`miniprogram/config.js` 设 `ENV='server'` 即可真机预览（仅开发版/体验版，正式版不可用 HTTP）。

## 2. 域名 + ICP 备案（最长路径，立刻启动）

微信小程序 **request 合法域名必须是已备案的 HTTPS 域名**，测试号/开发版可跳过，正式版不行。顺序很重要：

1. **买域名**：阿里云万网任意 `.com/.cn`，首年约 ¥30–80。完成域名实名认证（1–2 天）。
2. **先备案、后解析**：首次备案期间管局要求网站不可访问，所以**先不要把 A 记录指向服务器**。
   入口：阿里云 [beian.aliyun.com](https://beian.aliyun.com) → 开始备案 → 主体选**个人** →
   网站名称用非行业化名字（如「雄鸡日常记录」，个人主体不能带「平台/商城/企业」字样）→
   按提示做人脸核验、提交承诺书 → 阿里云初审 1–2 天 → 管局短信核验（收到后 24h 内完成）→
   管局审核 **1–3 周**。备案号下发后网站底部需悬挂备案号并链接到工信部。
3. **备案通过后**再添加 DNS：`@` 与 `www` 两条 A 记录 → `8.148.93.37`，TTL 600。
4. 服务器安全组/防火墙：阿里云控制台「防火墙」放行 80、443（ufw 已在脚本内放行）。

> 备案与开发可并行：备案期间用第 1 步的 IP + 开发版继续联调，不阻塞任何开发工作。

## 3. HTTPS 证书（备案通过 + DNS 生效后）

```bash
apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d your.domain.com -d www.your.domain.com
# 按提示填邮箱、同意条款；certbot 自动改写 nginx 配置加 443 与 80→443 跳转
nginx -t && systemctl reload nginx
curl https://your.domain.com/api/health
```

证书自动续期由 certbot 的 systemd timer 负责：`systemctl list-timers | grep certbot`。

## 4. 微信正式号 + 订阅消息模板 + 服务端凭据

1. **注册正式小程序**：[mp.weixin.qq.com](https://mp.weixin.qq.com) → 立即注册 → 小程序 →
   主体**个人**（身份证 + 个人银行卡扫码核验）→ 类目选 **工具 > 效率**（提醒类匹配，无需前置审批）。
   测试号 `wx9d4dcd67ac495721` 只能开发调试，**不能发布**；正式号 AppID 会换一个新的。
2. **订阅消息模板**：正式号后台 → 功能 → 订阅消息 → 公共模板库搜「提醒/待办/日程」类一次性模板，
   选用含 **事项(thing)、时间(time)、备注/温馨提示(thing)** 三个字段的模板。
   记下模板 ID 与字段 key（如 `thing1/time2/thing3`）。若 key 不同，改 `server/src/wx.js` 的 `data` 映射。
3. **拿凭据**：开发管理 → 开发设置 → AppID / AppSecret（Secret 只展示一次，妥善保存）；
   「服务器域名」request 合法域名填 `https://your.domain.com`（每月可改 5 次，备案后才能填）。
4. **写入服务器**：

```bash
nano /opt/rooster/.env      # 填 WX_APPID / WX_SECRET / WX_TEMPLATE_ID
pm2 restart rooster-server
pm2 logs rooster-server --lines 20   # 应显示 dev=false
```

`dev=false` 后：登录走真实 `code2session`，推送走真实订阅消息，`SEED_DEMO=false` 不再注入演示数据。

## 5. 小程序端切换与提审

1. `miniprogram/config.js`：`ENV='prod'`、`BASE.prod='https://your.domain.com'`、`TEMPLATE_ID='<模板ID>'`。
2. `project.config.json`：`appid` 换成**正式号 AppID**；`setting.urlCheck` 改回 `true`。
3. 开发者工具导入本目录 → 真机预览走一遍：新建 → 授权订阅 → 到点收到微信服务通知 → 完成/贪睡/删除撤销。
4. 上传代码 → 后台「版本管理」→ 提交审核（1–7 天，通常 1–2 天）→ 审核通过后「发布」。
   提审备注写明：工具类提醒应用，登录仅获取 openid 用于数据隔离，订阅消息为用户主动授权的一次性提醒。
5. 隐私协议：后台「设置 → 服务内容声明 → 用户隐私保护指引」勾选 **微信openid、头像、昵称**（头像昵称仅本人可见）。

## 6. 日常运维

```bash
pm2 status / pm2 restart rooster-server / pm2 logs rooster-server
tail -f /var/log/rooster/error.log
/opt/rooster/deploy/backup.sh                 # 手动备份一次
ls /opt/rooster/backups                       # 每日备份，保留 14 天
# 恢复：pm2 stop rooster-server && cp backups/rooster-<ts>.db server/data/rooster.db && pm2 start rooster-server
# 更新代码：本机 scp -r server root@IP:/root/rooster-src && 服务器 rsync 同步后 pm2 restart rooster-server
```

### 故障速查

| 现象 | 原因 / 处理 |
| --- | --- |
| `EADDRINUSE :3000` | 旧 node 进程未退：`ss -lntp \| grep 3000` 后 `kill <pid>`，再 `pm2 restart` |
| `ERR_UNKNOWN_BUILTIN_MODULE node:sqlite` | Node < 22.5 或未带 flag；`src/bootstrap.js` 会自动补 `--experimental-sqlite` 重启自身，确认 `node -v` ≥ 22.5 |
| npm 404 / 超时 | 公司源缺包：`npm install --registry=https://registry.npmmirror.com` |
| 真机请求失败 | 域名未备案 / 未填合法域名 / 仍用 HTTP；开发期勾「不校验合法域名」 |
| 收不到微信推送 | 订阅额度为 0（用户未授权或已消耗）；模板 key 不匹配看 `pm2 logs` 的 errcode；`notifications` 表 channel 字段可查降级原因 |
| 推送 errcode 43101 | 用户未订阅/拒收，属正常降级为站内提醒 |

---

上线门槛清单（缺一不可）：正式个人小程序 ✔ 类目工具>效率 ✔ 已备案域名 ✔ HTTPS ✔
request 合法域名 ✔ 订阅模板 ID ✔ `.env` 三凭据 ✔ `config.js ENV='prod'` ✔ 隐私指引 ✔ 提审发布 ✔