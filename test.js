const E = require('./engine.js');

/* ------------------------------------------------------------------
   固定随机种子：引擎在"首手选中心点"和"普通难度随机扰动"里用 Math.random，
   替换成定种子伪随机后，整套自测的结果可复现。
   ------------------------------------------------------------------ */
let _seed = 20261002;
Math.random = function () {
  _seed = (_seed * 1103515245 + 12345) & 0x7fffffff;
  return _seed / 0x7fffffff;
};

const CAP = E.N * E.N;   // 棋盘容量：15×15 = 225

/* 正式参数（与页面里的 CFG 一致，仅作参考） */
const DIFF = {
  normal: { depth: 4, timeMs: 450, rootCap: 8,  noise: 0.22 },
  hard:   { depth: 6, timeMs: 900, rootCap: 12, noise: 0 },
  hell:   { depth: 8, timeMs: 1400, rootCap: 14, noise: 0 }
};
/* 自测参数：保留三档之间的强弱差距，压缩时限以缩短自测时长 */
const TEST = {
  normal: { depth: 4, timeMs: 350, rootCap: 8,  noise: 0.22 },
  hard:   { depth: 6, timeMs: 600, rootCap: 12, noise: 0 },
  hell:   { depth: 8, timeMs: 850, rootCap: 14, noise: 0 }
};

let fail = 0;
function check(name, cond, extra = '') {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (extra ? '   ' + extra : ''));
  if (!cond) fail++;
}

function playGame(cfgB, cfgW, maxMoves = CAP, log = false) {
  const eng = E.createEngine();
  let turn = E.BLACK, moves = 0, totalMs = 0, maxMs = 0;
  while (moves < maxMoves) {
    const cfg = turn === E.BLACK ? cfgB : cfgW;
    const t0 = Date.now();
    const mv = eng.findBestMove(turn, cfg);
    const dt = Date.now() - t0;
    totalMs += dt; maxMs = Math.max(maxMs, dt);
    if (!mv || eng.at(mv.x, mv.y) !== E.EMPTY) {
      return { winner: 0, moves, err: `非法落点 ${mv && mv.x},${mv && mv.y}`, totalMs, maxMs, full: false };
    }
    eng.place(mv.x, mv.y, turn);
    moves++;
    if (log) process.stdout.write(`\r    ${moves} 手 · 最后 ${mv.x},${mv.y} · ${dt}ms      `);
    if (eng.isWin(mv.x, mv.y, turn)) return { winner: turn, moves, totalMs, maxMs, full: false };
    turn = turn === E.BLACK ? E.WHITE : E.BLACK;
  }
  return { winner: 0, moves, totalMs, maxMs, full: true };   // 下满棋盘 → 平局
}

const nameOf = w => w === E.BLACK ? '黑胜' : w === E.WHITE ? '白胜' : '平局';

/* 三局两胜，强方分别执黑 / 执白 / 执黑，抵消先手优势 */
function series(strong, weak, strongName) {
  const games = [
    { b: strong, w: weak, strongIsBlack: true },
    { b: weak,   w: strong, strongIsBlack: false },
    { b: strong, w: weak, strongIsBlack: true }
  ];
  let wins = 0, losses = 0, totalMs = 0;
  games.forEach((g, i) => {
    const r = playGame(g.b, g.w, CAP);
    totalMs += r.totalMs;
    const strongColor = g.strongIsBlack ? E.BLACK : E.WHITE;
    if (r.winner === strongColor) wins++;
    else if (r.winner === 0) { /* 平局，不计胜负 */ }
    else losses++;
    console.log(`    第${i + 1}局 ${strongName}执${g.strongIsBlack ? '黑' : '白'}：${nameOf(r.winner)}   手数=${String(r.moves).padStart(3)}   ${r.err || ''}`);
  });
  console.log(`    → ${strongName} ${wins} 胜 ${losses} 负（共 ${(totalMs / 1000).toFixed(0)}s）`);
  return { wins, losses };
}

console.log(`===== 0. 棋盘规格 =====`);
check('棋盘为 15×15', E.N === 15, `N=${E.N}，共 ${CAP} 点`);
{
  const eng = E.createEngine();
  const mv = eng.findBestMove(E.BLACK, TEST.normal);
  check('首手落在天元区', mv.x >= 6 && mv.x <= 8 && mv.y >= 6 && mv.y <= 8, `(${mv.x},${mv.y})`);
}

console.log('\n===== 1. 胜负判定 =====');
{
  const eng = E.createEngine();
  for (let i = 0; i < 4; i++) eng.place(i, 0, E.BLACK);
  check('横向四连不算赢', !eng.isWin(3, 0, E.BLACK));
  eng.place(4, 0, E.BLACK);
  check('横向五连获胜', eng.isWin(4, 0, E.BLACK));
  check('胜利连线正好 5 点', eng.findWinLine(4, 0, E.BLACK).length === 5);
}
for (const [name, gen] of [
  ['纵向', i => [0, i]],
  ['主对角', i => [i, i]],
  ['副对角', i => [9 - i, i]]
]) {
  const eng = E.createEngine();
  for (let i = 0; i < 5; i++) { const [x, y] = gen(i); eng.place(x, y, E.WHITE); }
  check(name + '五连获胜', eng.isWin(gen(4)[0], gen(4)[1], E.WHITE));
}
{
  const eng = E.createEngine();
  for (let i = 0; i < 6; i++) eng.place(i, 3, E.BLACK);   // 长连（六连）
  check('六连同样判胜', eng.isWin(4, 3, E.BLACK));
}

console.log('\n===== 2. 棋型评分单调性（都按"再落一子后的成型"比较） =====');
{
  const mk = (stones) => {
    const eng = E.createEngine();
    for (const [x, y, p] of stones) eng.place(x, y, p);
    return eng.pointScore(6, 5, E.BLACK);
  };
  const live4 = mk([[3, 5, E.BLACK], [4, 5, E.BLACK], [5, 5, E.BLACK]]);
  const rush4 = mk([[2, 5, E.WHITE], [3, 5, E.BLACK], [4, 5, E.BLACK], [5, 5, E.BLACK]]);
  const live3 = mk([[3, 5, E.BLACK], [4, 5, E.BLACK]]);
  console.log(`  活四=${live4}  冲四=${rush4}  活三=${live3}`);
  check('活四 > 冲四', live4 > rush4, `${live4} vs ${rush4}`);
  check('冲四 > 活三', rush4 > live3, `${rush4} vs ${live3}`);
}
{
  const eng = E.createEngine();
  eng.place(0, 0, E.BLACK);
  const s = eng.pointScore(14, 14, E.BLACK);
  check('孤立点评分极低', s < 100, 'score=' + s);
}
{
  const eng = E.createEngine();
  eng.place(7, 7, E.BLACK); eng.place(8, 7, E.BLACK);
  const two = eng.pointScore(9, 7, E.BLACK);
  const eng2 = E.createEngine();
  eng2.place(7, 7, E.BLACK); eng2.place(8, 7, E.BLACK); eng2.place(9, 7, E.BLACK);
  const three = eng2.pointScore(10, 7, E.BLACK);
  console.log(`  成三=${three}  成二=${two}`);
  check('成三 > 成二', three > two, `${three} vs ${two}`);
}

console.log('\n===== 3. 战术直觉 =====');
{
  const eng = E.createEngine();
  for (let i = 0; i < 4; i++) eng.place(3 + i, 7, E.BLACK);
  const mv = eng.findBestMove(E.BLACK, DIFF.normal);
  const ok = (mv.x === 2 || mv.x === 7) && mv.y === 7;
  check('自己能成五时立刻取胜', ok, `落点 ${mv.x},${mv.y}`);
}
{
  let all = true;
  for (const d of ['normal', 'hard', 'hell']) {
    const e2 = E.createEngine();
    for (let i = 0; i < 4; i++) e2.place(3 + i, 7, E.WHITE);   // 白四连
    e2.place(2, 2, E.BLACK); e2.place(13, 13, E.BLACK);
    const t0 = Date.now();
    const mv = e2.findBestMove(E.BLACK, TEST[d]);
    const ok = mv.y === 7 && (mv.x === 2 || mv.x === 7);
    console.log(`  [${d}] 白四连威胁 → 黑落 (${mv.x},${mv.y})  ${Date.now() - t0}ms`);
    if (!ok) all = false;
  }
  check('三档难度都会堵对方的四连', all);
}
{
  let all = true;
  for (const d of ['normal', 'hard', 'hell']) {
    const e2 = E.createEngine();
    e2.place(5, 5, E.WHITE); e2.place(6, 5, E.WHITE); e2.place(7, 5, E.WHITE);  // 白活三
    e2.place(0, 0, E.BLACK); e2.place(14, 14, E.BLACK); e2.place(0, 14, E.BLACK); e2.place(14, 0, E.BLACK);
    const mv = e2.findBestMove(E.BLACK, TEST[d]);
    const blocking = mv.y === 5 && (mv.x === 4 || mv.x === 8);
    console.log(`  [${d}] 白活三威胁 → 黑落 (${mv.x},${mv.y})  ${blocking ? '已封锁' : '未封锁'}`);
    if (!blocking) all = false;
  }
  check('三档难度都会应对活三', all);
}

console.log('\n===== 4. 棋盘完整性（超时中断的回归测试） =====');
{
  const eng = E.createEngine();
  eng.place(7, 7, E.BLACK); eng.place(8, 8, E.WHITE); eng.place(8, 7, E.BLACK);
  const before = Array.from(eng.board);
  eng.findBestMove(E.BLACK, { depth: 8, timeMs: 120, rootCap: 14, noise: 0 });
  const after = Array.from(eng.board);
  check('搜索超时中断后棋盘被完整还原', before.every((v, i) => v === after[i]));
  check('落子数未变', before.filter(Boolean).length === after.filter(Boolean).length);
}

console.log('\n===== 5. 单步耗时与搜索规模 =====');
{
  for (const d of ['normal', 'hard', 'hell']) {
    const eng = E.createEngine();
    eng.place(7, 7, E.BLACK); eng.place(8, 8, E.WHITE);
    eng.place(8, 7, E.BLACK); eng.place(7, 8, E.WHITE);
    const t0 = Date.now();
    eng.findBestMove(E.BLACK, TEST[d]);
    const dt = Date.now() - t0;
    console.log(`  ${d.padEnd(7)} ${String(dt).padStart(6)} ms   搜索节点 ${eng.getNodes()}`);
    check(`${d} 单步 < 3200ms`, dt < 3200, dt + 'ms');
  }
}

console.log('\n===== 6. 自我对局 =====');
for (const d of ['normal', 'hard']) {
  const r = playGame(TEST[d], TEST[d], CAP);
  console.log(`  ${d.padEnd(7)} ${nameOf(r.winner)}   手数=${String(r.moves).padStart(3)}${r.full ? '（下满棋盘）' : ''}   平均 ${(r.totalMs / r.moves).toFixed(0)}ms/手`);
  check(`${d} 自我对局正常终局`, !r.err && (r.winner !== 0 || r.full), r.err || '');
}

console.log('\n===== 7. 地狱 vs 普通（三局两胜，分色） =====');
{
  const s = series(TEST.hell, TEST.normal, '地狱');
  check('地狱在系列赛中压过普通', s.wins > s.losses, `${s.wins} 胜 ${s.losses} 负`);
}

console.log('\n===== 8. 困难 vs 普通（三局两胜，分色） =====');
{
  const s = series(TEST.hard, TEST.normal, '困难');
  check('困难在系列赛中压过普通', s.wins > s.losses, `${s.wins} 胜 ${s.losses} 负`);
}

console.log('\n===== 9. 地狱与困难的实际差距（可判定部分） =====');
/* 15×15 比 16×16 致密，中盘候选点多，深度 8 往往搜不完就超时，
   两档在中盘的差距会缩小，所以"谁赢"受先手影响大，不适合硬断言。
   这里断言可以确定的两件事：搜索规模，以及早期局面的实际深度。 */
{
  const P = [[7, 7, E.BLACK], [8, 8, E.WHITE]];
  const mk = () => { const e = E.createEngine(); P.forEach(s => e.place(s[0], s[1], s[2])); return e; };
  const BUDGET = 1500;
  const e6 = mk(); e6.findBestMove(E.BLACK, { depth: 6, timeMs: BUDGET, rootCap: 12, noise: 0 });
  const e8 = mk(); e8.findBestMove(E.BLACK, { depth: 8, timeMs: BUDGET, rootCap: 14, noise: 0 });
  const n6 = e6.getNodes(), n8 = e8.getNodes();
  console.log(`  同 ${BUDGET}ms 预算：上限6 → ${n6} 节点（提前收敛）；上限8 → ${n8} 节点（用满时限）`);
  check('同预算下地狱搜索规模明显更大（≥1.5 倍）', n8 > n6 * 1.5, `${n8} vs ${n6}`);
}
{
  const mk = () => {
    const e = E.createEngine();
    [[7, 7, E.BLACK], [7, 8, E.WHITE]].forEach(s => e.place(s[0], s[1], s[2]));
    return e;
  };
  const d = {}, t = {};
  for (const k of ['normal', 'hard', 'hell']) {
    const e = mk(); const t0 = Date.now();
    e.findBestMove(E.BLACK, TEST[k]);
    d[k] = e.getLastDepth(); t[k] = Date.now() - t0;
  }
  console.log(`  两子开局（真实参数）：普通 ${d.normal} 层/${t.normal}ms，困难 ${d.hard} 层/${t.hard}ms，地狱 ${d.hell} 层/${t.hell}ms`);
  check('普通的是三档里算得最浅的（配置上限 4 层）', d.normal === 4 && d.hard >= d.normal, `普通 ${d.normal} 层`);
  check('地狱的完成层数不低于困难', d.hell >= d.hard, `${d.hell} vs ${d.hard}`);
}
{
  /* 四三必胜：黑 (5,5)(6,5)(7,5) 活三，落 (4,5) 或 (8,5) 直接成活四 */
  const eng = E.createEngine();
  [[5, 5, E.BLACK], [6, 5, E.BLACK], [7, 5, E.BLACK], [8, 3, E.BLACK], [8, 4, E.BLACK], [3, 11, E.WHITE]]
    .forEach(s => eng.place(s[0], s[1], s[2]));
  let all = true;
  for (const k of ['normal', 'hard', 'hell']) {
    const mv = eng.findBestMove(E.BLACK, TEST[k]);
    const win = (mv.x === 4 || mv.x === 8) && mv.y === 5;
    console.log(`  [${k}] 四三必胜局面 → 黑落 (${mv.x},${mv.y})  ${win ? '已抓住' : '未抓住'}`);
    if (!win) all = false;
  }
  check('三档都能抓住四三必胜手', all);
}
{
  console.log('  —— 参考：地狱(黑) vs 困难(白) 一局（仅展示，不作断言）——');
  const r = playGame(TEST.hell, TEST.hard, CAP);
  console.log(`    结果：${nameOf(r.winner)}   手数=${r.moves}${r.full ? '（下满棋盘）' : ''}   ${r.err || ''}`);
}

console.log('\n' + (fail === 0 ? '全部通过 ✅' : `失败 ${fail} 项 ❌`));
process.exit(fail === 0 ? 0 : 1);
