const api = require('../../utils/api');
const fmt = require('../../utils/format');
const sound = require('../../utils/sound');

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'today', label: '今天' },
  { key: 'overdue', label: '已过期' },
  { key: 'urgent', label: '高优先' },
  { key: 'done', label: '已结束' }
];
const SORTS = [
  { key: 'time', label: '按时间' },
  { key: 'urgency', label: '按紧急度' },
  { key: 'created', label: '按创建' }
];

Page({
  data: {
    loading: true,
    reminders: [],
    filters: FILTERS,
    sorts: SORTS,
    filter: 'all',
    sort: 'time',
    sortIndex: 0,
    q: '',
    greeting: '',
    dateLabel: '',
    muted: false,
    quota: 0,
    dev: false,
    stats: null,
    snoozeTarget: null,
    crowOverlay: null,
    undo: null,
    now: Date.now()
  },

  onLoad() {
    this._poll = null;
    this._undoTimer = null;
    this._searchTimer = null;
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 });
    }
    this.refresh();
    this._poll = setInterval(() => this.refresh(true), 20000);
  },

  onHide() {
    clearInterval(this._poll);
    this.setData({ crowOverlay: null });
  },

  onUnload() {
    clearInterval(this._poll);
    clearTimeout(this._undoTimer);
    clearTimeout(this._searchTimer);
  },

  onPullDownRefresh() {
    this.refresh().finally(() => wx.stopPullDownRefresh());
  },

  async refresh(silent) {
    const app = getApp();
    try {
      await app.ready;
    } catch (e) {
      this.setData({ loading: false });
      if (!silent) wx.showToast({ title: '登录失败，请检查网络', icon: 'none' });
      return;
    }
    const { filter, sort, q } = this.data;
    try {
      const [list, me] = await Promise.all([
        api.get(`/api/reminders?filter=${filter}&sort=${sort}&q=${encodeURIComponent(q)}`),
        api.get('/api/me')
      ]);
      const now = list.now || Date.now();
      const reminders = list.reminders.map((r) => this.decorate(r, now));
      this.setData({
        loading: false,
        reminders,
        now,
        muted: me.user.muted,
        quota: me.user.sub_quota,
        dev: me.dev,
        stats: me.stats,
        greeting: fmt.greeting(now),
        dateLabel: fmt.dateLabel(now)
      });
      sound.setMuted(me.user.muted);
      app.globalData.user = me.user;
      this.detectFires(list.reminders, now);
    } catch (e) {
      this.setData({ loading: false });
      if (!silent) wx.showToast({ title: e.message, icon: 'none' });
    }
  },

  decorate(r, now) {
    const u = fmt.URGENCY[r.urgency] || fmt.URGENCY[2];
    return Object.assign({}, r, {
      urgencyMeta: u,
      freqLabel: fmt.freqLabel(r),
      nextLabel: fmt.fmtNext(r.occurrence_at, now),
      fireLabel: r.lead_min ? fmt.fmtNext(r.next_fire_at, now) + ' 推送' : '',
      overdueLabel: r.overdue ? fmt.fmtAgo(r.occurrence_at, now) : '',
      statusLabel: r.status === 'done' ? '已完成' : r.status === 'ignored' ? '已忽略' : ''
    });
  },

  detectFires(rows, now) {
    const app = getApp();
    const seen = app.globalData.seenFires;
    let overlay = null;
    let toasted = false;
    rows.forEach((r) => {
      if (r.last_fired_at && (!seen[r.id] || seen[r.id] < r.last_fired_at)) {
        app.markFire(r.id, r.last_fired_at);
        if (r.urgency === 4 && !overlay) {
          overlay = this.decorate(r, now);
        } else if (!toasted) {
          toasted = true;
          wx.showToast({ title: '叮 · ' + r.title + ' 到点了', icon: 'none', duration: 2500 });
          sound.play('ding');
        }
      }
    });
    if (overlay) {
      this.setData({ crowOverlay: overlay });
      sound.play('crow');
    }
  },

  onSearch(e) {
    const q = e.detail.value;
    this.setData({ q });
    clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => this.refresh(true), 250);
  },

  onFilter(e) {
    this.setData({ filter: e.currentTarget.dataset.key });
    this.refresh(true);
  },

  onSort(e) {
    const i = Number(e.detail.value);
    this.setData({ sortIndex: i, sort: SORTS[i].key });
    this.refresh(true);
  },

  async onComplete(e) {
    const id = e.currentTarget.dataset.id;
    try {
      const res = await api.post(`/api/reminders/${id}/complete`);
      sound.play('ding');
      wx.showToast({ title: res.reminder.freq_type === 'once' ? '完成！雄鸡为你骄傲' : '完成！已排下一次', icon: 'none' });
      this.refresh(true);
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  openSnooze(e) {
    this.setData({ snoozeTarget: e.currentTarget.dataset.id });
  },
  closeSnooze() {
    this.setData({ snoozeTarget: null });
  },
  async pickSnooze(e) {
    const minutes = Number(e.currentTarget.dataset.min);
    const id = this.data.snoozeTarget;
    this.setData({ snoozeTarget: null });
    try {
      await api.post(`/api/reminders/${id}/snooze`, { minutes });
      wx.showToast({ title: `贪睡 ${minutes} 分钟`, icon: 'none' });
      this.refresh(true);
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  onMore(e) {
    const id = e.currentTarget.dataset.id;
    const r = this.data.reminders.find((x) => x.id === id);
    wx.showActionSheet({
      itemList: ['编辑提醒', '删除提醒'],
      success: (res) => {
        if (res.tapIndex === 0) {
          wx.navigateTo({ url: '/pages/edit/edit?id=' + id });
        } else if (res.tapIndex === 1) {
          this.remove(id, r);
        }
      },
      fail: () => {}
    });
  },

  async remove(id, r) {
    try {
      await api.del('/api/reminders/' + id);
      this.setData({
        reminders: this.data.reminders.filter((x) => x.id !== id),
        undo: { id, title: r ? r.title : '提醒' }
      });
      clearTimeout(this._undoTimer);
      this._undoTimer = setTimeout(() => this.setData({ undo: null }), 6000);
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  async onUndo() {
    const undo = this.data.undo;
    if (!undo) return;
    clearTimeout(this._undoTimer);
    this.setData({ undo: null });
    try {
      await api.post(`/api/reminders/${undo.id}/restore`);
      wx.showToast({ title: '已恢复', icon: 'none' });
      this.refresh(true);
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  async onToggleMute() {
    const muted = !this.data.muted;
    this.setData({ muted });
    sound.setMuted(muted);
    try {
      await api.put('/api/me', { muted });
      wx.showToast({ title: muted ? '已静音' : '声音已开启', icon: 'none' });
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  goCreate() {
    wx.navigateTo({ url: '/pages/edit/edit' });
  },

  async crowComplete() {
    const r = this.data.crowOverlay;
    this.setData({ crowOverlay: null });
    if (r) await api.post(`/api/reminders/${r.id}/complete`).catch(() => {});
    sound.play('ding');
    this.refresh(true);
  },
  async crowSnooze() {
    const r = this.data.crowOverlay;
    this.setData({ crowOverlay: null });
    if (r) await api.post(`/api/reminders/${r.id}/snooze`, { minutes: 10 }).catch(() => {});
    this.refresh(true);
  },
  async crowIgnore() {
    const r = this.data.crowOverlay;
    this.setData({ crowOverlay: null });
    if (r) await api.post(`/api/reminders/${r.id}/ignore`).catch(() => {});
    this.refresh(true);
  },

  noop() {}
});