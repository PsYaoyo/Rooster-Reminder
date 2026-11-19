let muted = false;
const pool = {};

function ctx(name) {
  if (!pool[name]) {
    const a = wx.createInnerAudioContext();
    a.src = '/assets/' + name + '.wav';
    a.onError(() => {});
    pool[name] = a;
  }
  return pool[name];
}

function setMuted(v) {
  muted = !!v;
  if (muted) Object.keys(pool).forEach((k) => pool[k].stop());
}

function isMuted() {
  return muted;
}

function play(name) {
  if (muted) return;
  try {
    const a = ctx(name);
    a.stop();
    a.play();
  } catch (e) { /* audio unavailable: stay silent */ }
}

module.exports = { setMuted, isMuted, play };