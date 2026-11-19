Component({
  data: {
    selected: 0
  },
  methods: {
    onTab(e) {
      const idx = Number(e.currentTarget.dataset.idx);
      const url = idx === 0 ? '/pages/index/index' : '/pages/mine/mine';
      wx.switchTab({ url });
    },
    onCreate() {
      wx.navigateTo({ url: '/pages/edit/edit' });
    }
  }
});