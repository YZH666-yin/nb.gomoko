/* 五子棋引擎：棋盘 / 胜负 / 棋型评估 / Alpha-Beta 搜索
   同时兼容浏览器（挂到 window.GomokuEngine）与 Node（module.exports），便于离线自测。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GomokuEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var N = 15;
  var EMPTY = 0, BLACK = 1, WHITE = 2;
  var DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];
  var WIN_SCORE = 9000000;

  /* ============ 一、棋型识别表（1=我 0=空 2=对方/边界） ============
     逐条匹配、先匹配到的优先，所以必须按分值从高到低排列。 */

  /* 9 格窗口：用于"某个点落子后有多好"，上下文更宽，做走法排序 */
  var PAT9 = [
    [/11111/, 10000000],                                          // 五连
    [/011110/, 1000000],                                          // 活四
    [/011112|211110/, 100000],                                    // 冲四
    [/11011|10111|11101/, 100000],                                // 跳四（冲四）
    [/011100|001110/, 50000],                                     // 活三
    [/011010|010110/, 45000],                                     // 跳活三
    [/001112|211100|010112|211010|011012|210110/, 5000],          // 眠三
    [/10101|10011|11001|01011|11010/, 4500],
    [/001100/, 1000],                                             // 活二
    [/011000|000110|010100|001010/, 800],
    [/0110|01010/, 700],
    [/000112|211000|010012|210010|011002|200110/, 200],           // 眠二
    [/10001/, 180],
    [/01|10/, 20]
  ];

  /* 6 格窗口：用于全盘局面评估。短窗口落在 3^6=729 种组合上，可整表缓存 */
  var PAT6 = [
    [/11111/, 10000000],                                          // 五连
    [/011110/, 1000000],                                          // 活四
    [/011112|211110/, 100000],                                    // 冲四
    [/11011|10111|11101/, 100000],                                // 跳四
    [/011100|001110/, 50000],                                     // 活三
    [/011010|010110/, 45000],                                     // 跳活三
    [/001112|211100|010112|211010|011012|210110/, 5000],          // 眠三
    [/10101|10011|11001|01011|11010/, 4500],
    [/001100/, 1000],                                             // 活二
    [/011000|000110|010100|001010/, 800],
    [/0110|01010/, 700],
    [/000112|211000|010012|210010|011002|200110/, 200],           // 眠二
    [/10001/, 180],
    [/01|10/, 20]
  ];

  function patternValue(pats, s) {
    for (var i = 0; i < pats.length; i++) if (pats[i][0].test(s)) return pats[i][1];
    return 0;
  }

  var CACHE9 = Object.create(null);
  function match9(s) {
    var v = CACHE9[s];
    if (v === undefined) { v = patternValue(PAT9, s); CACHE9[s] = v; }
    return v;
  }

  var CACHE6 = Object.create(null);
  var SWAP = { '0': '0', '1': '2', '2': '1' };
  function match6(s) {
    var v = CACHE6[s];
    if (v !== undefined) return v;
    var t = '';
    for (var i = 0; i < 6; i++) t += SWAP[s.charAt(i)];
    v = [patternValue(PAT6, s), patternValue(PAT6, t)];
    CACHE6[s] = v;
    return v;
  }

  /* ============ 二、6 格窗口表：让全盘评估变成 O(1) 增量更新 ============ */
  var W6 = [], CELLW6 = null;

  function initWindows() {
    W6.length = 0;
    CELLW6 = new Array(N * N);
    for (var i = 0; i < N * N; i++) CELLW6[i] = [];
    for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
      for (var d = 0; d < 4; d++) {
        var dx = DIRS[d][0], dy = DIRS[d][1];
        var ex = x + dx * 5, ey = y + dy * 5;
        if (ex < 0 || ex >= N || ey < 0 || ey >= N) continue;
        var cells = [];
        for (var k = 0; k < 6; k++) cells.push((y + dy * k) * N + (x + dx * k));
        var wi = W6.length;
        W6.push(cells);
        for (var j = 0; j < 6; j++) CELLW6[cells[j]].push(wi);
      }
    }
  }
  initWindows();

  function createEngine() {
    var board = new Int8Array(N * N);
    var winB = new Int32Array(W6.length);
    var winW = new Int32Array(W6.length);
    var scB = 0, scW = 0;
    var nodes = 0;
    var lastDepth = 0;          /* 迭代加深里实际完成的最大层数（供自测读取） */

    function updateWin(wi) {
      var cells = W6[wi], s = '';
      for (var i = 0; i < 6; i++) {
        var v = board[cells[i]];
        s += v === 0 ? '0' : (v === 1 ? '1' : '2');
      }
      var pr = match6(s);
      scB += pr[0] - winB[wi]; winB[wi] = pr[0];
      scW += pr[1] - winW[wi]; winW[wi] = pr[1];
    }

    function place(x, y, p) {
      var c = y * N + x; board[c] = p;
      var ws = CELLW6[c];
      for (var i = 0; i < ws.length; i++) updateWin(ws[i]);
    }
    function remove(x, y) {
      var c = y * N + x; board[c] = EMPTY;
      var ws = CELLW6[c];
      for (var i = 0; i < ws.length; i++) updateWin(ws[i]);
    }
    function reset() {
      board.fill(0); winB.fill(0); winW.fill(0); scB = 0; scW = 0;
    }
    function resync() {
      winB.fill(0); winW.fill(0); scB = 0; scW = 0;
      for (var i = 0; i < W6.length; i++) updateWin(i);
    }

    function inB(x, y) { return x >= 0 && x < N && y >= 0 && y < N; }
    function at(x, y) { return inB(x, y) ? board[y * N + x] : -1; }

    /* 某点落子后，四个方向的棋型得分之和（走法排序用） */
    function pointScore(x, y, p) {
      var total = 0;
      for (var d = 0; d < 4; d++) {
        var dx = DIRS[d][0], dy = DIRS[d][1], s = '';
        for (var k = -4; k <= 4; k++) {
          if (k === 0) { s += '1'; continue; }
          var nx = x + dx * k, ny = y + dy * k;
          if (!inB(nx, ny)) { s += '2'; continue; }
          var v = board[ny * N + nx];
          s += v === 0 ? '0' : (v === p ? '1' : '2');
        }
        total += match9(s);
      }
      return total;
    }

    function isWin(x, y, p) {
      for (var d = 0; d < 4; d++) {
        var dx = DIRS[d][0], dy = DIRS[d][1], c = 1, k;
        for (k = 1; k < 5; k++) { if (at(x + dx * k, y + dy * k) !== p) break; c++; }
        for (k = 1; k < 5; k++) { if (at(x - dx * k, y - dy * k) !== p) break; c++; }
        if (c >= 5) return true;
      }
      return false;
    }

    function findWinLine(x, y, p) {
      for (var d = 0; d < 4; d++) {
        var dx = DIRS[d][0], dy = DIRS[d][1], line = [{ x: x, y: y }], k, a, b;
        for (k = 1; k < 5; k++) { a = { x: x + dx * k, y: y + dy * k }; if (at(a.x, a.y) !== p) break; line.push(a); }
        for (k = 1; k < 5; k++) { b = { x: x - dx * k, y: y - dy * k }; if (at(b.x, b.y) !== p) break; line.unshift(b); }
        if (line.length >= 5) return line;
      }
      return null;
    }

    /* 候选点：已有棋子周围 2 格内的空点 */
    function candidates() {
      var near = new Uint8Array(N * N), any = false, i, x, y, dx, dy, nx, ny;
      for (y = 0; y < N; y++) for (x = 0; x < N; x++) {
        if (!board[y * N + x]) continue;
        any = true;
        for (dy = -2; dy <= 2; dy++) for (dx = -2; dx <= 2; dx++) {
          nx = x + dx; ny = y + dy;
          if (inB(nx, ny) && !board[ny * N + nx]) near[ny * N + nx] = 1;
        }
      }
      var out = [];
      if (!any) { out.push({ x: 7, y: 7 }); return out; }
      for (i = 0; i < N * N; i++) if (near[i]) out.push({ x: i % N, y: (i / N) | 0 });
      return out;
    }

    var DEF = 1.12;
    function evaluate(me) {
      var my = me === BLACK ? scB : scW;
      var op = me === BLACK ? scW : scB;
      return my - op * DEF;
    }

    var now = (typeof performance !== 'undefined' && performance.now)
      ? function () { return performance.now(); } : function () { return Date.now(); };
    var deadline = Infinity;
    var TIMEOUT = { timeout: true };

    function alphabeta(depth, alpha, beta, turn, aiColor, rootDepth) {
      if (((nodes++) & 255) === 0 && now() > deadline) throw TIMEOUT;
      var cands = candidates();
      if (!cands.length) return 0;
      var opp = turn === BLACK ? WHITE : BLACK;
      var scored = [], i;
      for (i = 0; i < cands.length; i++) {
        var c = cands[i];
        scored.push({
          x: c.x, y: c.y,
          s: pointScore(c.x, c.y, turn) + pointScore(c.x, c.y, opp) * 0.9
        });
      }
      scored.sort(function (a, b) { return b.s - a.s; });
      var cap = depth >= 5 ? 12 : (depth >= 3 ? 10 : 8);
      var list = scored.slice(0, cap);
      var isMax = (turn === aiColor);
      var best = isMax ? -Infinity : Infinity;
      for (i = 0; i < list.length; i++) {
        var m = list[i], val;
        place(m.x, m.y, turn);
        try {
          if (isWin(m.x, m.y, turn)) {
            val = (turn === aiColor) ? (WIN_SCORE - (rootDepth - depth)) : (-WIN_SCORE + (rootDepth - depth));
          } else if (depth <= 1) {
            val = evaluate(aiColor);
          } else {
            val = alphabeta(depth - 1, alpha, beta, opp, aiColor, rootDepth);
          }
        } finally {
          /* 超时靠抛异常中断，必须保证棋盘一定还原 */
          remove(m.x, m.y);
        }
        if (isMax) { if (val > best) best = val; if (best > alpha) alpha = best; }
        else { if (val < best) best = val; if (best < beta) beta = best; }
        if (alpha >= beta) break;
      }
      return best;
    }

    function isBoardEmpty() {
      for (var i = 0; i < N * N; i++) if (board[i]) return false;
      return true;
    }

    /* 立即成五的落点 */
    function immediateWin(p) {
      var cands = candidates();
      for (var i = 0; i < cands.length; i++) {
        var c = cands[i], w;
        place(c.x, c.y, p);
        w = isWin(c.x, c.y, p);
        remove(c.x, c.y);
        if (w) return c;
      }
      return null;
    }

    function findBestMove(aiColor, cfg) {
      cfg = cfg || {};
      var depth = cfg.depth || 6;
      var timeMs = cfg.timeMs || 1200;
      var rootCap = cfg.rootCap || 14;
      var noise = cfg.noise || 0;
      nodes = 0;
      deadline = now() + timeMs;
      lastDepth = 0;

      if (isBoardEmpty()) {
        var centers = [{ x: 7, y: 7 }, { x: 8, y: 8 }, { x: 7, y: 8 }, { x: 8, y: 7 }];
        return centers[(Math.random() * centers.length) | 0];
      }

      var opp = aiColor === BLACK ? WHITE : BLACK;
      /* 规则一：自己能成五 → 直接赢 */
      var w = immediateWin(aiColor);
      if (w) return w;
      /* 规则二：对方能成五 → 堵掉 */
      var blk = immediateWin(opp);
      if (blk) return blk;

      var cands = candidates(), i;
      var scored = [];
      for (i = 0; i < cands.length; i++) {
        var c = cands[i];
        scored.push({
          x: c.x, y: c.y,
          s: pointScore(c.x, c.y, aiColor) + pointScore(c.x, c.y, opp) * 0.9,
          v: -Infinity
        });
      }
      scored.sort(function (a, b) { return b.s - a.s; });
      var rootList = scored.slice(0, rootCap);
      var best = rootList[0];

      try {
        for (var d = 2; d <= depth; d += 2) {
          var alpha = -Infinity, localBest = rootList[0], localScore = -Infinity;
          for (var j = 0; j < rootList.length; j++) {
            var m = rootList[j], val;
            place(m.x, m.y, aiColor);
            try {
              if (isWin(m.x, m.y, aiColor)) val = WIN_SCORE;
              else val = alphabeta(d - 1, alpha, Infinity, opp, aiColor, d);
            } finally {
              remove(m.x, m.y);
            }
            m.v = val;
            if (val > localScore) { localScore = val; localBest = m; }
            if (val > alpha) alpha = val;
            if (localScore >= WIN_SCORE - 100) break;
          }
          best = localBest;
          lastDepth = d;
          if (localScore >= WIN_SCORE - 100) break;
          rootList.sort(function (a, b) { return b.v - a.v; });
        }
      } catch (e) {
        if (e !== TIMEOUT) throw e;
      }

      /* 普通难度：在接近最优的候选中随机挑，制造可乘之机（有必胜手时不动摇） */
      if (noise > 0 && best.v < WIN_SCORE - 100 && Math.random() < noise) {
        var pool = rootList.filter(function (m) { return m.v > -Infinity && m.v < WIN_SCORE - 100; });
        if (pool.length > 1) {
          var k = 1 + ((Math.random() * Math.min(2, pool.length - 1)) | 0);
          if (pool[k]) return pool[k];
        }
      }
      return best;
    }

    return {
      N: N, board: board,
      place: place, remove: remove, reset: reset, resync: resync,
      at: at, isWin: isWin, findWinLine: findWinLine,
      pointScore: pointScore, candidates: candidates,
      findBestMove: findBestMove,
      getNodes: function () { return nodes; },
      getLastDepth: function () { return lastDepth; },
      scoreBoard: function (p) { return p === BLACK ? scB : scW; },
      isBoardEmpty: isBoardEmpty
    };
  }

  return {
    N: N, EMPTY: EMPTY, BLACK: BLACK, WHITE: WHITE,
    WIN_SCORE: WIN_SCORE,
    createEngine: createEngine
  };
});
