/* 用最小 DOM 桩把 五子棋.html 里真实发布的脚本跑起来，端到端验证。 */
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '五子棋.html');
const html = fs.readFileSync(file, 'utf8');
const blocks = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);

let fail = 0;
const check = (name, cond, extra = '') => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (extra ? '   ' + extra : ''));
  if (!cond) fail++;
};

console.log('===== 0. 脚本提取与语法 =====');
check('找到脚本块', blocks.length >= 1, '共 ' + blocks.length + ' 块');
blocks.forEach((s, i) => {
  try { new Function(s); check(`脚本块 ${i} 语法通过`, true, s.length + ' 字符'); }
  catch (e) { check(`脚本块 ${i} 语法通过`, false, e.message); }
});

/* ---------- 最小 DOM 桩 ---------- */
function makeCtx() {
  const grad = { addColorStop() {} };
  const noop = () => {};
  return {
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '', textBaseline: '',
    globalAlpha: 1, lineCap: '',
    setTransform: noop, clearRect: noop, fillRect: noop, strokeRect: noop,
    translate: noop, scale: noop, rotate: noop, clip: noop, setLineDash: noop,
    beginPath: noop, moveTo: noop, lineTo: noop, arc: noop, fill: noop, stroke: noop,
    save: noop, restore: noop, drawImage: noop, fillText: noop, closePath: noop,
    createLinearGradient: () => grad, createRadialGradient: () => grad
  };
}

class El {
  constructor(tag, id) {
    this.tag = tag; this.id = id; this.children = []; this._h = {}; this.style = {};
    this.textContent = ''; this.innerHTML = ''; this.scrollTop = 0; this.scrollHeight = 0;
    this.disabled = false; this.clientWidth = 560; this.attrs = {};
    const set = new Set();
    this.classList = {
      _s: set,
      add: c => set.add(c),
      remove: c => set.delete(c),
      contains: c => set.has(c),
      toggle: (c, f) => { if (f === undefined) { set.has(c) ? set.delete(c) : set.add(c); } else if (f) set.add(c); else set.delete(c); }
    };
  }
  addEventListener(t, f) { (this._h[t] = this._h[t] || []).push(f); }
  fire(t, ev) { (this._h[t] || []).forEach(f => f(Object.assign({ preventDefault() {}, target: this }, ev))); }
  querySelectorAll() { return this.children; }
  appendChild(c) { this.children.push(c); return c; }
  getAttribute(a) { return this.attrs[a]; }
  setAttribute(a, v) { this.attrs[a] = v; }
  closest() { return this; }
  getContext() { return this._ctx || (this._ctx = makeCtx()); }
  getBoundingClientRect() {
    const w = parseFloat(this.style.width) || 560;
    return { left: 0, top: 0, width: w, height: w };
  }
}

const ids = ['stage', 'board', 'result', 'resultTitle', 'resultSub', 'turnChip', 'turnText',
  'moveNo', 'lastMove', 'logList', 'undoBtn', 'restartBtn', 'soundBtn', 'againBtn', 'viewBtn',
  'diffHint', 'diffCard', 'sideCard', 'modeSeg', 'diffSeg', 'sideSeg', 'toast',
  'thinkBar', 'elapsed'];
const store = {};
ids.forEach(id => { store[id] = new El(id === 'board' ? 'canvas' : 'div', id); });
store.stage.clientWidth = 560;

/* 分段控件的子按钮 */
function seg(id, vals, attr) {
  store[id].children = vals.map(v => { const b = new El('button'); b.attrs[attr] = v; b.attrs['data-x'] = v; return b; });
  store[id].children[0].classList.add('on');
}
seg('modeSeg', ['pve', 'pvp'], 'data-mode');
seg('diffSeg', ['normal', 'hard', 'hell'], 'data-diff');
seg('sideSeg', ['1', '2'], 'data-side');

const document = {
  getElementById: id => store[id] || (store[id] = new El('div', id)),
  createElement: tag => new El(tag),
  addEventListener() {}
};
let frames = 0;
const requestAnimationFrame = cb => { if (frames++ < 4) setTimeout(cb, 0); return frames; };
const performanceStub = { now: () => Date.now() };
const windowStub = { addEventListener() {}, devicePixelRatio: 1 };

console.log('\n===== 1. 引擎随页面一起加载 =====');
let bootErr = null;
let EG = null;
try {
  /* 把 self 与 window 绑到同一个桩对象上：引擎挂到 self，游戏从 window 取，浏览器里两者本来就是同一个 */
  new Function('self', 'window', 'document', 'requestAnimationFrame', 'performance', 'setTimeout', 'clearTimeout', blocks[0])(
    windowStub, windowStub, document, requestAnimationFrame, performanceStub, setTimeout, clearTimeout
  );
  EG = windowStub.GomokuEngine;
} catch (e) { bootErr = e; }
check('引擎已挂载', !!EG && typeof EG.createEngine === 'function');
check('棋盘为 15×15', !!EG && EG.N === 15);

console.log('\n===== 2. 启动游戏界面 =====');
check('界面脚本无异常启动', !bootErr, bootErr ? (bootErr.message + ' @ ' + (bootErr.stack || '').split('\n')[1]) : '');
if (bootErr) { console.log(bootErr.stack); process.exit(1); }

/* 复算坐标：margin = round(size*0.058)，cell = (size-2*margin)/(N-1) */
const SIZE = 560;
const M = Math.round(SIZE * 0.058);
const CELL = (SIZE - 2 * M) / 14;
const at = (x, y) => ({ clientX: M + x * CELL, clientY: M + y * CELL });

const cnt = () => parseInt(store.moveNo.textContent, 10) || 0;
const cells = () => (store.logList.innerHTML.match(/class="pos"/g) || []).length;

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async function run() {
  console.log('\n===== 3. 单人模式：落子 → AI 应手 =====');
  store.board.fire('click', at(7, 7));
  await sleep(30);
  check('点击后我方落子', cnt() === 1, '手数 ' + cnt());
  check('棋谱同步记录', cells() === 1);
  check('轮次切到 AI 思考', /思考/.test(store.turnText.innerHTML) || /AI/.test(store.turnText.textContent),
    JSON.stringify(store.turnText.textContent));
  await sleep(900);
  check('AI 已应手（共 2 手）', cnt() === 2, '手数 ' + cnt());
  check('AI 落子后回到我方回合', /轮到你/.test(store.turnText.textContent), store.turnText.textContent);

  console.log('\n===== 4. 悔棋：应撤销一整轮（AI + 我方） =====');
  store.undoBtn.fire('click');
  await sleep(60);
  check('悔棋后棋盘清空', cnt() === 0, '手数 ' + cnt());
  check('棋谱同步清空', /还没有落子/.test(store.logList.innerHTML));
  check('悔棋按钮变为禁用', store.undoBtn.disabled === true);

  console.log('\n===== 5. 重复落子与非法位置 =====');
  store.board.fire('click', at(3, 3));
  await sleep(900);
  const before = cnt();
  store.board.fire('click', at(3, 3));   // 再点同一个位置
  await sleep(60);
  check('已占位置不会被覆盖', cnt() === before, '手数 ' + cnt());
  store.board.fire('click', { clientX: 3, clientY: 3 });  // 棋盘外
  await sleep(40);
  check('棋盘外的点击被忽略', cnt() === before);

  console.log('\n===== 6. 双人模式：连续落子直到五连获胜 =====');
  store.modeSeg.fire('click', { target: store.modeSeg.children[1] });
  await sleep(60);
  check('切到双人模式后棋盘清空', cnt() === 0, '手数 ' + cnt());

  const moves = [[0, 0], [0, 5], [1, 0], [1, 5], [2, 0], [2, 5], [3, 0], [3, 5], [4, 0]];
  for (const [x, y] of moves) { store.board.fire('click', at(x, y)); await sleep(12); }
  check('双人模式连下 9 手', cnt() === 9, '手数 ' + cnt());
  await sleep(900);
  check('弹出结算层', store.result.classList.contains('show'));
  check('判定黑棋获胜', store.resultTitle.textContent === '黑棋胜利', store.resultTitle.textContent);
  check('结算文案含手数', /共 9 手/.test(store.resultSub.textContent), store.resultSub.textContent);

  console.log('\n===== 7. 结束后不可续下 / 可以悔棋复活 =====');
  store.board.fire('click', at(9, 9));
  await sleep(40);
  check('终局后点击棋盘无效', cnt() === 9, '手数 ' + cnt());
  store.undoBtn.fire('click');
  await sleep(60);
  check('悔棋后回到 8 手', cnt() === 8, '手数 ' + cnt());
  check('结算层关闭', !store.result.classList.contains('show'));
  store.board.fire('click', at(4, 0));
  await sleep(40);
  check('可以继续落子', cnt() === 9, '手数 ' + cnt());

  console.log('\n===== 8. 重新开始 / 音效开关 =====');
  store.restartBtn.fire('click');
  await sleep(40);
  check('重新开始后棋盘为空', cnt() === 0, '手数 ' + cnt());
  const s0 = store.soundBtn.textContent;
  store.soundBtn.fire('click');
  check('音效开关可切换', store.soundBtn.textContent !== s0, s0 + ' → ' + store.soundBtn.textContent);

  console.log('\n===== 9. 页面内联引擎 与 engine.js 行为一致性 =====');
  {
    const E2 = require('./engine.js');
    const POS = [
      [[7, 7, 1], [8, 8, 2], [8, 7, 1], [7, 8, 2], [9, 9, 1], [6, 6, 2]],
      [[7, 7, 2], [8, 8, 1], [6, 6, 2], [9, 7, 1], [10, 6, 2], [5, 9, 1], [7, 9, 2]],
      [[4, 4, 1], [5, 4, 1], [6, 4, 2], [5, 5, 2], [3, 5, 1], [7, 3, 2], [2, 6, 1]]
    ];
    const cfg = { depth: 4, timeMs: 30000, rootCap: 10, noise: 0 };
    let same = true, sameDepth = true;
    POS.forEach((pos, i) => {
      const a = EG.createEngine(), b = E2.createEngine();
      pos.forEach(([x, y, p]) => { a.place(x, y, p); b.place(x, y, p); });
      const ma = a.findBestMove(1, cfg), mb = b.findBestMove(1, cfg);
      const ok = ma && mb && ma.x === mb.x && ma.y === mb.y;
      const okD = a.getLastDepth() === b.getLastDepth();
      if (!ok) same = false;
      if (!okD) sameDepth = false;
      console.log(`  局面 ${i + 1}：页面 (${ma.x},${ma.y})/${a.getLastDepth()}层   引擎 (${mb.x},${mb.y})/${b.getLastDepth()}层   ${ok && okD ? '一致' : '不一致'}`);
    });
    check('三处局面选点完全一致', same);
    check('三处局面完成层数一致', sameDepth);
  }

  console.log('\n' + (fail === 0 ? '全部通过 ✅' : `失败 ${fail} 项 ❌`));
  process.exit(fail === 0 ? 0 : 1);
})();
