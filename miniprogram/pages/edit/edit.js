const api = require('../../utils/api');
const fmt = require('../../utils/format');
const config = require('../../config');

const FREQ_OPTIONS = [
  { key: 'once', label: '单次' },
  { key: 'daily', label: '每天' },
  { key: 'weekly', label: '每周' },
  { key: 'interval', label: '自定义间隔' },
  { key: 'monthly', label: '每月' }
];
const LEAD_OPTIONS = [
  { value: 0, label: '准时提醒' },
  { value: 5, label: '提前 5 分钟' },
  { value: 15, label: '提前 15 分钟' },
  { value: 30, label: '提前 30 分钟' },
  { value: 60, label: '提前 1 小时' }
];
const WEEK_OPTIONS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const URGENCY_OPTIONS = [
  { value: 1, label: '低', desc: '从容处理' },
  { value: 2, label: '中', desc: '记得就好' },
  { value: 3, label: '高', desc: '尽快处理' },
  { value: 4, label: '紧急', desc: '全屏打鸣' }
];

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${fmt.pad2(d.getMonth() + 1)}-${fmt.pad2(d.getDate())}`;
}

Page({
  data: {
    id: null,
    freqOptions: FREQ_OPTIONS,
    freqIndex: 0,
    leadOptions: LEAD_OPTIONS,
    leadIndex: 0,
    weekOptions: WEEK_OPTIONS,
    monthDays: Array.from({ length: 31 }, (_, i) => (i + 1) + ' 日'),
    urgencyOptions: URGENCY_OPTIONS,
    form: {
      title: '',
      note: '',
      urgency: 2,
      freq_type: 'once',
      interval_value: 1,
      interval_unit: 'day',
      weekly_day: 1,
      monthly_day: 1,
      start_date: todayStr(),
      time_str: '09:00',
      lead_min: 0
    },
    quota: 0,
    dev: false,
    templateConfigured: false,
    saving: false,
    minDate: todayStr()
  },

  async onLoad(options) {
    const app = getApp();
    try { await app.ready; } catch (e) {}
    const me = await api.get('/api/me').catch(() => null);
    if (me) {
      this.setData({ quota: me.user.sub_quota, dev: me.dev, templateConfigured: me.templateConfigured });
    }
    if (options.id) {
      const list = await api.get('/api/reminders?filter=all').catch(() => null);
      const r = list && list.reminders.find((x) => String(x.id) === String(options.id));
      if (!r) {
        wx.showToast({ title: '提醒不存在', icon: 'none' });
        setTimeout(() => wx.navigateBack(), 800);
        return;
      }
      const freqIndex = FREQ_OPTIONS.findIndex((f) => f.key === r.freq_type);
      const leadIndex = LEAD_OPTIONS.findIndex((l) => l.value === r.lead_min);
      this.setData({
        id: r.id,
        freqIndex: freqIndex < 0 ? 0 : freqIndex,
        leadIndex: leadIndex < 0 ? 0 : leadIndex,
        form: {
          title: r.title,
          note: r.note,
          urgency: r.urgency,
          freq_type: r.freq_type,
          interval_value: r.interval_value,
          interval_unit: r.interval_unit,
          weekly_day: r.weekly_day == null ? 1 : r.weekly_day,
          monthly_day: r.monthly_day == null ? 1 : r.monthly_day,
          start_date: r.start_date,
          time_str: r.time_str,
          lead_min: r.lead_min
        }
      });
      wx.setNavigationBarTitle({ title: '编辑提醒' });
    }
  },

  setForm(patch) {
    this.setData({ form: Object.assign({}, this.data.form, patch) });
  },

  onTitle(e) { this.setForm({ title: e.detail.value }); },
  onNote(e) { this.setForm({ note: e.detail.value }); },
  onUrgency(e) { this.setForm({ urgency: Number(e.currentTarget.dataset.v) }); },
  onDate(e) { this.setForm({ start_date: e.detail.value }); },
  onTime(e) { this.setForm({ time_str: e.detail.value }); },
  onFreq(e) {
    const i = Number(e.detail.value);
    this.setData({ freqIndex: i });
    this.setForm({ freq_type: FREQ_OPTIONS[i].key });
  },
  onWeek(e) { this.setForm({ weekly_day: Number(e.detail.value) }); },
  onMonthDay(e) { this.setForm({ monthly_day: Number(e.detail.value) + 1 }); },
  onLead(e) {
    const i = Number(e.detail.value);
    this.setData({ leadIndex: i });
    this.setForm({ lead_min: LEAD_OPTIONS[i].value });
  },
  onUnit(e) { this.setForm({ interval_unit: e.currentTarget.dataset.u }); },
  stepInterval(e) {
    const delta = Number(e.currentTarget.dataset.d);
    const v = Math.min(99, Math.max(1, this.data.form.interval_value + delta));
    this.setForm({ interval_value: v });
  },

  async grantSubscribe() {
    // Returns accepted grant count (0 if user declined).
    if (this.data.templateConfigured && config.TEMPLATE_ID) {
      return new Promise((resolve) => {
        wx.requestSubscribeMessage({
          tmplIds: [config.TEMPLATE_ID],
          success: (res) => resolve(res[config.TEMPLATE_ID] === 'accept' ? 1 : 0),
          fail: () => resolve(0)
        });
      });
    }
    // Dev mode: simulate one grant so the quota loop is exercisable end to end.
    const ok = await new Promise((resolve) => {
      wx.showModal({
        title: '订阅授权（开发模式）',
        content: '正式上线后这里会弹出微信订阅消息授权。现在模拟获得 1 次推送额度。',
        confirmText: '模拟允许',
        cancelText: '跳过',
        success: (r) => resolve(r.confirm),
        fail: () => resolve(false)
      });
    });
    return ok ? 1 : 0;
  },

  async onSave() {
    if (this.data.saving) return;
    const f = this.data.form;
    if (!f.title.trim()) {
      wx.showToast({ title: '给提醒起个名字吧', icon: 'none' });
      return;
    }
    if (f.freq_type === 'once') {
      const occ = new Date(`${f.start_date}T${f.time_str}:00`).getTime();
      if (occ <= Date.now()) {
        wx.showToast({ title: '单次提醒需晚于现在', icon: 'none' });
        return;
      }
    }
    this.setData({ saving: true });
    try {
      const grant = await this.grantSubscribe();
      if (grant > 0) await api.post('/api/me/subscribe', { count: grant }).catch(() => {});
      const payload = Object.assign({}, f, { title: f.title.trim() });
      if (this.data.id) {
        await api.put('/api/reminders/' + this.data.id, payload);
      } else {
        await api.post('/api/reminders', payload);
      }
      getApp().globalData.needRefresh = true;
      wx.showToast({ title: this.data.id ? '已保存' : '雄鸡记下了', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 600);
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  }
});