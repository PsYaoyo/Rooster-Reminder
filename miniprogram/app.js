const api = require('./utils/api');
const sound = require('./utils/sound');

App({
  globalData: {
    user: null,
    dev: false,
    templateConfigured: false,
    needRefresh: false,
    seenFires: {}
  },
  ready: null,
  onLaunch() {
    this.globalData.seenFires = wx.getStorageSync('rr_seen_fires') || {};
    this.ready = api.login()
      .then((l) => this.applyLogin(l))
      .catch((e) => {
        console.error('[login]', e.message);
        throw e;
      });
  },
  applyLogin(l) {
    this.globalData.user = l.user;
    this.globalData.dev = l.dev;
    this.globalData.templateConfigured = !!l.templateConfigured;
    sound.setMuted(l.user.muted);
    return l;
  },
  markFire(id, at) {
    this.globalData.seenFires[id] = at;
    wx.setStorageSync('rr_seen_fires', this.globalData.seenFires);
  }
});