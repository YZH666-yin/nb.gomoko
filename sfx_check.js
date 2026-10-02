/* 音效冒烟测试：用 mock AudioContext 跑一遍所有音效，捕获 API 误用。
   仅用于本地验证，验证完即可删除。 */
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '五子棋.html'), 'utf8');
const start = html.indexOf('var Sfx = (function () {');
const end = html.indexOf('\n})();', start);
if (start < 0 || end < 0) { console.error('未找到 Sfx 模块'); process.exit(1); }
const src = html.slice(start, end + 6);

let fail = 0;
const check = (n, c, extra = '') => { console.log((c ? '  PASS  ' : '  FAIL  ') + n + (extra ? '   ' + extra : '')); if (!c) fail++; };

/* ---- mock WebAudio ---- */
const created = {};
function cnt(k) { created[k] = (created[k] || 0) + 1; }
function param(v) {
  const p = { value: v === undefined ? 1 : v };
  p.setValueAtTime = (x) => { assertNum(x, 'setValueAtTime'); p.value = x; return p; };
  p.exponentialRampToValueAtTime = (x) => { assertNum(x, 'exponentialRamp'); if (x <= 0) throw new Error('exponentialRamp 目标必须 > 0，收到 ' + x); p.value = x; return p; };
  p.linearRampToValueAtTime = (x) => { p.value = x; return p; };
  return p;
}
function assertNum(x, where) { if (typeof x !== 'number' || !isFinite(x)) throw new Error(where + ' 需要有限数值，收到 ' + x); }
function node(extra = {}) {
  return Object.assign({
    connect(t) { if (t === undefined || t === null) throw new Error('connect 目标为空'); return t; },
    disconnect() {}
  }, extra);
}
function mockAC() {
  return {
    state: 'running', currentTime: 1.5, sampleRate: 48000,
    destination: node(),
    resume() { this.state = 'running'; },
    createGain() { cnt('gain'); return node({ gain: param(1) }); },
    createOscillator() {
      cnt('osc');
      return node({
        type: 'sine', frequency: param(440),
        start(at) { assertNum(at, 'osc.start'); },
        stop(at) { assertNum(at, 'osc.stop'); if (at <= this._start) throw new Error('stop 早于 start'); },
        _start: 0
      });
    },
    createBufferSource() {
      cnt('src');
      return node({ buffer: null, start(at) { assertNum(at, 'src.start'); this._st = at; }, stop(at) { assertNum(at, 'src.stop'); if (at <= this._st) throw new Error('src.stop 早于 start'); } });
    },
    createBiquadFilter() { cnt('biquad'); return node({ type: 'lowpass', Q: param(1), frequency: param(350) }); },
    createConvolver() { cnt('conv'); return node({ buffer: null }); },
    createDynamicsCompressor() {
      cnt('comp');
      return node({ threshold: param(-24), knee: param(30), ratio: param(12), attack: param(0.003), release: param(0.25) });
    },
    createBuffer(ch, len, sr) {
      cnt('buffer');
      if (!(len > 0)) throw new Error('createBuffer 长度非法: ' + len);
      return { length: len, numberOfChannels: ch, sampleRate: sr, getChannelData: () => new Float32Array(len) };
    }
  };
}

const winStub = { AudioContext: mockAC };
let Sfx = null;
try {
  Sfx = new Function('window', src + '\n;return Sfx;')(winStub);
} catch (e) { console.error('模块求值失败:', e.message); process.exit(1); }

console.log('===== 音效模块冒烟测试 =====');
check('Sfx 导出完整', Sfx && ['ensure', 'clack', 'win', 'lose', 'undo', 'deny', 'set', 'isOn'].every(k => typeof Sfx[k] === 'function'));

const cases = [
  ['ensure（初始化音频图）', () => Sfx.ensure()],
  ['clack 黑子落子', () => Sfx.clack(true)],
  ['clack 白子落子', () => Sfx.clack(false)],
  ['place 别名可用', () => Sfx.place(true)],
  ['win 胜利琶音', () => Sfx.win()],
  ['lose 失败下行', () => Sfx.lose()],
  ['undo 悔棋音', () => Sfx.undo()],
  ['deny 非法操作', () => Sfx.deny()]
];
for (const [name, fn] of cases) {
  try { fn(); check(name, true); }
  catch (e) { check(name, false, e.message); }
}

console.log('\n  —— 连续 40 次落子（检查随机化与资源节点创建） ——');
try {
  for (let i = 0; i < 40; i++) Sfx.clack(i % 2 === 0);
  check('连续落子 40 次无异常', true);
} catch (e) { check('连续落子 40 次无异常', false, e.message); }

console.log('\n  —— 静音开关 ——');
try {
  Sfx.set(false);
  check('关音效后 isOn=false', Sfx.isOn() === false);
  Sfx.clack(true); Sfx.win(); Sfx.undo();
  check('静音状态下调用不发生异常', true);
  Sfx.set(true);
  check('重新开启后 isOn=true', Sfx.isOn() === true);
} catch (e) { check('静音开关', false, e.message); }

console.log('\n  创建的音频节点：' + Object.entries(created).map(([k, v]) => k + '=' + v).join('  '));
check('确实建了混响节点（空间感）', (created.conv || 0) >= 1);
check('确实建了压限节点（防爆音）', (created.comp || 0) >= 1);
check('振荡器数量合理（<400）', (created.osc || 0) < 400, String(created.osc));

console.log('\n' + (fail === 0 ? '全部通过 ✅' : `失败 ${fail} 项 ❌`));
process.exit(fail === 0 ? 0 : 1);
