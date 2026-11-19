'use strict';
// Drives the real WeChat DevTools runtime: create / complete / snooze / delete-undo /
// search / filter / mute / crow-overlay / mine flows, with screenshots.
const path = require('path');
const automator = require('miniprogram-automator');

const ROOT = path.join(__dirname, '..');
const SHOTS = path.join(__dirname, 'shots');
const CLI = 'D:/wxDevp/微信web开发者工具/cli.bat';
const API = 'http://127.0.0.1:3000';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
let step = 0;

function ok(name, cond, extra) {
  step++;
  if (!cond) {
    console.log(`FAIL ${step} ${name}${extra ? ' :: ' + extra : ''}`);
    process.exitCode = 1;
    throw new Error('assertion failed: ' + name);
  }
  console.log(`ok ${step} ${name}`);
}

async function shot(mp, name) {
  await mp.screenshot({ path: path.join(SHOTS, name + '.png') });
  console.log('   shot ' + name);
}

async function waitForData(page, pathStr, pred, timeout = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const v = await page.data(pathStr);
    if (pred(v)) return v;
    await sleep(500);
  }
  throw new Error('timeout waiting data ' + pathStr);
}

function pad2(n) { return String(n).padStart(2, '0'); }

(async () => {
  const mp = await automator.launch({ cliPath: CLI, projectPath: ROOT, timeout: 90000 });
  console.log('devtools launched');
  mp.on('console', (msg) => {
    if (msg.type === 'error') errors.push((msg.args || []).join(' '));
  });
  mp.on('exception', (e) => errors.push('exception: ' + (e.message || JSON.stringify(e))));

  await mp.mockWxMethod('showModal', { confirm: true, cancel: false });
  await mp.mockWxMethod('showActionSheet', { tapIndex: 1 });

  let page = await mp.currentPage();
  await page.waitFor('.cards .card', 30000);
  ok('index opens populated', (await page.data('reminders')).length >= 5);
  ok('overdue pinned first', (await page.data('reminders'))[0].overdue === true);
  await shot(mp, '01-index');

  // create flow (custom tab bar lives in a component tree; fall back to router if not selectable)
  const createBtn = await page.$('.create');
  if (createBtn) await createBtn.tap();
  else await mp.navigateTo('/pages/edit/edit');
  page = await mp.currentPage();
  await page.waitFor('.title-input');
  ok('edit page opened', page.path === 'pages/edit/edit');
  await (await page.$('.title-input')).input('自动化·紧急喝水');
  await (await page.$('.urgency.u4')).tap();
  const now = new Date(Date.now() + 30 * 60000);
  const dateStr = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  const timeStr = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  await page.callMethod('setForm', { start_date: dateStr, time_str: timeStr });
  await shot(mp, '02-edit-form');
  await (await page.$('.save-btn')).tap();
  await sleep(1500);
  page = await mp.currentPage();
  ok('back to index after save', page.path === 'pages/index/index');
  const created = await waitForData(page, 'reminders', (rs) => rs.some((r) => r.title === '自动化·紧急喝水'));
  const newR = created.find((r) => r.title === '自动化·紧急喝水');
  ok('new reminder urgency 4', newR.urgency === 4);
  ok('subscribe quota granted', (await page.data('quota')) >= 1);
  await shot(mp, '03-after-create');

  // complete
  let cards = await page.$$('.cards .card');
  let idx = created.findIndex((r) => r.id === newR.id);
  await (await cards[idx].$('.act.done')).tap();
  await sleep(900);
  const afterDone = await page.data('reminders');
  ok('complete removes from active', !afterDone.some((r) => r.id === newR.id));

  // snooze
  const before = await page.data('reminders');
  cards = await page.$$('.cards .card');
  await (await cards[0].$('.act.nap')).tap();
  await page.waitFor('.sheet');
  await shot(mp, '04-snooze-sheet');
  await (await page.$('.sheet-opt[data-min="10"]')).tap();
  await sleep(900);
  const afterNap = await page.data('reminders');
  ok('snooze increments count', afterNap.find((r) => r.id === before[0].id).snooze_count === 1);

  // delete + undo
  const countBefore = (await page.data('reminders')).length;
  cards = await page.$$('.cards .card');
  await (await cards[0].$('.act.more')).tap();
  await page.waitFor('.undo');
  ok('undo snackbar visible', (await page.data('undo')) !== null);
  await shot(mp, '05-undo');
  await (await page.$('.undo-btn')).tap();
  await sleep(900);
  ok('undo restores reminder', (await page.data('reminders')).length === countBefore);

  // search
  await (await page.$('.search-input')).input('喝水');
  await sleep(800);
  const searched = await page.data('reminders');
  ok('search filters live', searched.length >= 1 && searched.every((r) => r.title.includes('喝水')));
  await (await page.$('.search-input')).input('');
  await sleep(800);

  // filter overdue
  await (await page.$('.chip[data-key="overdue"]')).tap();
  await sleep(800);
  const overdue = await page.data('reminders');
  ok('overdue filter', overdue.length >= 1 && overdue.every((r) => r.overdue));
  await (await page.$('.chip[data-key="all"]')).tap();
  await sleep(600);

  // mute toggle
  await (await page.$('.mute')).tap();
  await sleep(600);
  ok('mute on', (await page.data('muted')) === true);
  await (await page.$('.mute')).tap();
  await sleep(600);
  ok('mute off', (await page.data('muted')) === false);

  // crow overlay: urgent reminder whose fire time is already past (lead 60, occ +30min)
  const token = await mp.evaluate(() => wx.getStorageSync('rr_token'));
  const resp = await fetch(API + '/api/reminders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({
      title: '全屏打鸣测试', urgency: 4, freq_type: 'once',
      start_date: dateStr, time_str: timeStr, lead_min: 60
    })
  });
  ok('urgent reminder created via api', resp.status === 201);
  const crow = await waitForData(page, 'crowOverlay', (v) => v !== null, 60000);
  ok('crow overlay triggered', crow.title === '全屏打鸣测试');
  await sleep(600);
  await shot(mp, '06-crow-overlay');
  await (await page.$('.crow-btn.primary')).tap();
  await sleep(900);
  ok('crow overlay dismissed by complete', (await page.data('crowOverlay')) === null);

  // mine page
  const mineTab = await page.$('.tab[data-idx="1"]');
  if (mineTab) await mineTab.tap();
  else await mp.switchTab('/pages/mine/mine');
  page = await mp.currentPage();
  await page.waitFor('.profile');
  ok('mine page opened', page.path === 'pages/mine/mine');
  const quotaBefore = (await page.data('user')).sub_quota;
  await (await page.$('.mini-btn.gold')).tap();
  await sleep(900);
  ok('quota top-up +3', (await page.data('user')).sub_quota === quotaBefore + 3);
  ok('push log populated', (await page.data('notifications')).length >= 1);
  await shot(mp, '07-mine');

  // back to index final state
  const idxTab = await page.$('.tab[data-idx="0"]');
  if (idxTab) await idxTab.tap();
  else await mp.switchTab('/pages/index/index');
  page = await mp.currentPage();
  await page.waitFor('.cards .card');
  await shot(mp, '08-final-index');

  const realErrors = errors.filter((e) => !/favicon|Download the React|devtools/i.test(e));
  ok('no runtime console errors', realErrors.length === 0, realErrors.join(' | ').slice(0, 500));

  await mp.close();
  console.log('ALL UI CHECKS PASSED');
})().catch(async (e) => {
  console.error('AUTOMATION ERROR:', e.message);
  console.error('console errors captured:', errors.slice(0, 10));
  process.exit(1);
});