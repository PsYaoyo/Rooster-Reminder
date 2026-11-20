const api = require('../../utils/api');
const fmt = require('../../utils/format');
const sound = require('../../utils/sound');
const config = require('../../config');

const CHANNEL = {
  wechat: { label: '微信推送', color: '#2E9E6B' },
  mock: { label: '模拟推送', color: '#2F6FED' },
  inapp: { label: '站内提醒', color: '#B45309' }
};

Page({
  data: {
    user: null,
    stats: null,
    dev: false,
    templateConfigured: false,
    notifications: [],
    version: config.VERSION,
    avatarTmp: ''
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 });
    }
    this.refresh();
  },

  async refresh() {
    const app = getApp();
    try { await app.ready; } catch (e) { return; }
    try {
      const [me, log] = await Promise.all([
        api.get('/api/me'),
        api.get('/api/me/notifications?limit=20')
      ]);
      this.setData({
        user: me.user,
        stats: me.stats,
        dev: me.dev,
        templateConfigured: me.templateConfigured,
        notifications: log.notifications.map((n) => Object.assign({}, n, {
          channelMeta: CHANNEL[n.channel] || CHANNEL.inapp,
          sentLabel: fmt.fmtSent(n.sent_at)
        }))
      });
      sound.setMuted(me.user.muted);
      app.globalData.user = me.user;
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
    }
  },

  onChooseAvatar(e) {
    const url = e.detail.avatarUrl;
    const fs = wx.getFileSystemManager();
    fs.readFile({
      filePath: url,
      encoding: 'base64',
      success: (res) => {
        const ext = (url.split('.').pop() || 'png').toLowerCase();
        const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/' + ext;
        const dataUrl = `data:${mime};base64,${res.data}`;
        if (dataUrl.length > 180000) {
          wx.showToast({ title: '头像过大，请换一张', icon: 'none' });
          return;
        }
        this.setData({ avatarTmp: dataUrl });
        api.put('/api/me', { avatar: dataUrl }).then(() => this.refresh()).catch(() => {});
      },
      fail: () => wx.showToast({ title: '头像读取失败', icon: 'none' })
    });
  },

  onNickname(e) {
    const v = (e.detail.value || '').trim();
    if (!v || v === (this.data.user && this.data.user.nickname)) return;
    api.put('/api/me', { nickname: v }).then(() => {
      wx.showToast({ title: '昵称已更新', icon: 'none' });
      this.refresh();
    }).catch(() => {});
  },

  async onMute(e) {
    const muted = e.detail.value;
    sound.setMuted(muted);
    try {
      await api.put('/api/me', { muted });
      this.setData({ 'user.muted': muted });
      wx.showToast({ title: muted ? '已静音' : '声音已开启', icon: 'none' });
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  async onTopUp() {
    const app = getApp();
    if (this.data.templateConfigured && config.TEMPLATE_ID) {
      wx.requestSubscribeMessage({
        tmplIds: [config.TEMPLATE_ID],
        success: async (res) => {
          const accepted = res[config.TEMPLATE_ID] === 'accept';
          const granted = await api.grantSubscribe(accepted);
          if (granted) {
            wx.showToast({ title: '额度 +1', icon: 'none' });
            this.refresh();
          } else {
            wx.showToast({ title: accepted ? '授权失败，请重试' : '未授权，额度不变', icon: 'none' });
          }
        },
        fail: () => wx.showToast({ title: '授权弹窗失败', icon: 'none' })
      });
      return;
    }
    const ok = await new Promise((resolve) => {
      wx.showModal({
        title: '补充推送额度（开发模式）',
        content: '模拟微信订阅授权，额度 +1。上线后此处为真实微信授权弹窗。',
        confirmText: '模拟允许',
        success: (r) => resolve(r.confirm),
        fail: () => resolve(false)
      });
    });
    if (ok) {
      const granted = await api.grantSubscribe(true);
      wx.showToast({ title: granted ? '额度 +1' : '授权失败，请重试', icon: 'none' });
      if (granted) this.refresh();
    }
  },

  onClearDone() {
    wx.showModal({
      title: '清除已结束提醒',
      content: '已完成与已忽略的提醒将被移入回收站（可逐条恢复）。',
      success: async (r) => {
        if (!r.confirm) return;
        const res = await api.post('/api/me/clear-done').catch((e) => {
          wx.showToast({ title: e.message, icon: 'none' });
          return null;
        });
        if (res) {
          wx.showToast({ title: `已清除 ${res.cleared} 条`, icon: 'none' });
          this.refresh();
        }
      }
    });
  },

  onPreviewSound() {
    sound.play('crow');
    wx.showToast({ title: this.data.user && this.data.user.muted ? '当前静音中' : '喔喔喔——', icon: 'none' });
  }
});