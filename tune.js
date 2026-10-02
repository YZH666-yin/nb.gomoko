const E = require('./engine.js');

function play(cfgB, cfgW, maxMoves = 225) {
  const eng = E.createEngine();
  let turn = E.BLACK, moves = 0, ms = 0;
  while (moves < maxMoves) {
    const cfg = turn === E.BLACK ? cfgB : cfgW;
    const t0 = Date.now();
    const mv = eng.findBestMove(turn, cfg);
    ms += Date.now() - t0;
    if (!mv || eng.at(mv.x, mv.y) !== E.EMPTY) return { winner: 0, moves, err: 'illegal' };
    eng.place(mv.x, mv.y, turn);
    moves++;
    if (eng.isWin(mv.x, mv.y, turn)) return { winner: turn, moves, ms };
    turn = turn === E.BLACK ? E.WHITE : E.BLACK;
  }
  return { winner: 0, moves, ms };
}

const name = (w, blackName, whiteName) => w === E.BLACK ? blackName + ' 胜' : w === E.WHITE ? whiteName + ' 胜' : '平局';

const CFG = {
  A: { depth: 2, timeMs: 300, rootCap: 8, noise: 0.18, label: '普通A 深度2/噪声18%' },
  B: { depth: 4, timeMs: 400, rootCap: 8, noise: 0.22, label: '普通B 深度4/噪声22%/剪枝8' },
  C: { depth: 4, timeMs: 400, rootCap: 10, noise: 0.12, label: '普通C 深度4/噪声12%/剪枝10' },
  H: { depth: 6, timeMs: 1000, rootCap: 12, noise: 0, label: '困难 深度6/剪枝12' },
  X: { depth: 8, timeMs: 1800, rootCap: 14, noise: 0, label: '地狱 深度8/剪枝14' }
};

console.log('=== 自我对局长度（衡量"这个难度能把自己拖多久"）===');
for (const k of ['A', 'B', 'C', 'H']) {
  const r = play(CFG[k], CFG[k], 225);
  console.log(`  ${CFG[k].label.padEnd(30)} ${name(r.winner, '黑', '白').padEnd(8)} 手数=${String(r.moves).padStart(3)}  ${(r.ms / r.moves).toFixed(0)}ms/手`);
}

console.log('\n=== 对抗：B/C 执黑 vs A 执白，再换色 ===');
for (const k of ['B', 'C']) {
  const r1 = play(CFG[k], CFG.A, 225);
  console.log(`  第1局 ${CFG[k].label} 执黑 : ${name(r1.winner, '新', 'A').padEnd(8)} 手数=${r1.moves}`);
  const r2 = play(CFG.A, CFG[k], 225);
  console.log(`  第2局 ${CFG[k].label} 执白 : ${name(r2.winner, 'A', '新').padEnd(8)} 手数=${r2.moves}`);
}

console.log('\n=== 对抗：困难 vs 各版本普通（各 1 局，困难执黑） ===');
for (const k of ['A', 'B', 'C']) {
  const r = play(CFG.H, CFG[k], 225);
  console.log(`  困难 vs ${CFG[k].label.padEnd(30)} ${name(r.winner, '困难', '普通').padEnd(10)} 手数=${r.moves}`);
}
