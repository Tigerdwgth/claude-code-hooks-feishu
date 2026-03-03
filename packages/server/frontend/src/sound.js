// Web Audio API 合成声音提醒
// Stop（任务完成）：上升双音调 C5→E5，清脆愉悦
// Notification（需要注意）：单音 A4，稍长

let _ctx = null;
function getCtx() {
  if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
  return _ctx;
}

function playTone(freq, startTime, duration, gainVal, ctx) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, startTime);
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(gainVal, startTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.05);
}

export function playSound(hookEvent) {
  try {
    const ctx = getCtx();
    const now = ctx.currentTime;
    if (hookEvent === 'Stop') {
      // 上升双音调：C5(523Hz) → E5(659Hz)
      playTone(523, now, 0.18, 0.3, ctx);
      playTone(659, now + 0.15, 0.25, 0.25, ctx);
    } else if (hookEvent === 'Notification') {
      // 单音 A4(440Hz)，稍长
      playTone(440, now, 0.35, 0.25, ctx);
    }
  } catch {}
}
