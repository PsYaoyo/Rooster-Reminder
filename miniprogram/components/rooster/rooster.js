Component({
  properties: {
    size: { type: Number, value: 160 },
    mood: { type: String, value: 'idle' }
  },
  data: { scale: 0.8 },
  observers: {
    size(v) {
      this.setData({ scale: v / 200 });
    }
  },
  lifetimes: {
    attached() {
      this.setData({ scale: this.data.size / 200 });
    }
  }
});