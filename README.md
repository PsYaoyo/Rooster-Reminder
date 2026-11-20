# Rooster Reminder · 雄鸡提醒器

微信小程序 + Node.js/SQLite 后端。到点让雄鸡替你打鸣：微信订阅消息推送、四档紧急度、
五种频率、提前量、完成/贪睡/忽略、过期置顶、删除撤销、全屏打鸣强提醒。

```
miniprogram/   小程序原生工程（pages: index 列表 / edit 表单 / mine 我的；custom-tab-bar；rooster 组件）
server/        Express + node:sqlite 后端（登录、提醒 CRUD、订阅额度、15s 调度器、推送降级）
preview/       与小程序同源同 API 的 H5 预览孪生页（浏览器可直接验收全部交互）
scripts/       gen-sounds.js 合成 crow.wav / ding.wav（无外部素材依赖）
tools/         automate.js 微信开发者工具自动化脚本（需本机已登录 DevTools）
deploy/        阿里云 Ubuntu 24.04 一键部署 + nginx + 备份 + 备案/上线指南
```

## 本地运行（Node ≥ 22.5）

```bash
cd server
npm install --registry=https://registry.npmmirror.com   # 公司源缺包时用镜像
npm start            # http://127.0.0.1:3000  （开发模式，bootstrap 自动补 --experimental-sqlite）
npm test             # 单元 + API 测试
npm run prod         # 用 server/.env 中的正式凭据运行（真实 code2session + 订阅消息）
```

`server/.env` 已被 `.gitignore` 忽略，保存正式 AppSecret；本地 `npm start` 不读取它，保持 H5 预览的开发模式可用。

- 浏览器验收：<http://127.0.0.1:3000/preview/> —— 与小程序同一套 API、同一套视觉，
  开发模式自动登录并注入 6 条演示提醒；到点模拟推送、紧急档全屏打鸣均可真实触发。
- 微信开发者工具：导入本目录（`project.config.json` 已指向 `miniprogram/`，测试号 appid），
  编译即可；开发模式后端无需微信凭据。真机/自动化见 `tools/automate.js`。
- 重新合成音效：`node scripts/gen-sounds.js`

## 配置（server 环境变量 / miniprogram/config.js）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` / `HOST` | 3000 / 0.0.0.0 | 生产设 `HOST=127.0.0.1`，由 nginx 反代 |
| `AUTH_SECRET` | dev 占位 | 生产必须随机值（setup.sh 自动生成） |
| `WX_APPID` / `WX_SECRET` | 空 | 空 = 开发模式（dev openid + 模拟推送 + 演示数据） |
| `WX_TEMPLATE_ID` | 空 | 订阅消息模板 ID；字段映射见 `server/src/wx.js` |
| `WX_MINIPROGRAM_STATE` | formal | 推送目标版本：formal / trial / developer（体验版调试用 trial） |
| `SEED_DEMO` | true | 生产设 false |
| `SCHEDULER_INTERVAL_MS` | 15000 | 调度tick |
| `MAX_REMINDERS` / `MAX_SUB_QUOTA` | 200 / 50 | 每用户上限 |
| `MAX_SUB_CHALLENGES` / `SUB_CHALLENGE_TTL_MS` | 5 / 300000 | 未完成授权挑战数上限 / 挑战有效期（毫秒） |

`miniprogram/config.js`：`ENV` = `local` | `server` | `prod`。后端只监听 `127.0.0.1:3000`，外部一律走 nginx 的 HTTPS（`https://www.bigshuai.xyz`），不要直连 `:3000`；证书只覆盖 `www` 主机。`TEMPLATE_ID` 填模板 ID 后保存时走真实 `wx.requestSubscribeMessage`。

## 产品语义

- 频率：单次 / 每天 / 每周 / 每 N 小时·天 / 每月（小月自动钳到月末）。
- 提前量 0/5/15/30/60 分钟：推送在「时间 − 提前量」下发；贪睡不消耗订阅额度。
- 紧急度 1–4：第 4 档到点全屏打鸣 + 音效；其余 toast + 叮声。一键全局静音。
- 生命周期：完成（重复自动排下一次）/ 贪睡 5·10·30·60 分 / 忽略；过期红色置顶；删除 6 秒内可撤销。
- 订阅授权：服务端签发一次性挑战码，一次授权最多 +1 额度且不可重放；正式推送由微信判定订阅是否有效（43101 自动降级站内提醒），本地额度不决定真实下发。
- 登录：`wx.login` 静默换 openid；头像昵称选填，仅本人可见。

## 上线

测试号不能发布。完整路径（正式个人号 → 域名 → ICP 备案 1–3 周 → HTTPS → 订阅模板 → 提审）
见 **[deploy/README.md](deploy/README.md)**；服务器一键 provisioning：`bash deploy/setup.sh`。

### 用 miniprogram-ci 上传代码（无需打开开发者工具）

1. 微信公众平台 → 开发管理 → 开发设置 → **小程序代码上传**：生成「代码上传密钥」，下载后保存为 `tools/private.key`（已被 `.gitignore` 忽略）；若开启 IP 白名单，把执行上传的机器公网 IP 加进去。
   在服务器上操作也一样：先 `git pull`，把服务器公网 IP 加入白名单，再进入 `tools/` 执行下面的命令；私钥可放任意路径，用 `WX_PRIVATE_KEY_PATH` 指向它。
2. 安装并上传：
   ```bash
   cd tools
   npm install --registry=https://registry.npmmirror.com
   npm run upload -- 1.0.0 "首次提审"      # 版本号 + 备注
   ```
   也可用环境变量：`CI_VERSION=1.0.1 CI_DESC=修复推送 npm run upload`；`CI_ROBOT=1` 指定 CI 机器人（1–30）。
3. 生成体验版二维码（真机验收用）：
   ```bash
   npm run preview                        # 输出 tools/preview-qr.jpg（已忽略）
   ```
4. 上传后到微信公众平台「版本管理」提交审核，通过后发布。

脚本在 `tools/upload.js`：appid 读取根目录 `project.config.json`，私钥只从本地读取，不会进入仓库。

## 验收状态

- 后端：35/35 测试通过（recurrence 引擎、一次性授权挑战码、额度扣减、推送降级、恢复、清除、调度触发）。
- 交互：H5 预览孪生页已在真实浏览器完成闭环验收（新建/编辑/完成/贪睡/删除+撤销/搜索/筛选/排序/
  我的/静音/额度/推送记录/全屏打鸣），无控制台报错，重复刷新状态稳定。
- 微信运行时：本环境无法无头启动开发者工具，`tools/automate.js` 供在已登录 DevTools 的本机复跑同一闭环。