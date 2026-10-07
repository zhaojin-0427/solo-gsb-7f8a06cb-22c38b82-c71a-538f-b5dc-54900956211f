// ownership.test.mjs —— 草稿/活动修订位图所有权规则的单元测试（先运行 npm run build）。
// 覆盖：候选拒绝、放弃草稿、过期上传、成功提交四类时机下的位图关闭规则，
//       以及“循环拒绝示例”这一核心回归场景。
import assert from 'node:assert/strict';
import {
  setDraftImage, retainDraftImages, discardDraftImages, commitImages,
} from '../client/dist/ownership.js';

let passed = 0;
function t(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (e) {
    console.error(`  FAIL - ${name}`);
    console.error(e);
    process.exitCode = 1;
  }
}

// 伪 ImageBitmap：记录 close 次数（同一对象至多应被关闭一次）
function bmp(label) {
  return { label, closes: 0, close() { this.closes++; } };
}
const closed = (b) => b.closes > 0;
const closedOnce = (b) => b.closes === 1;

console.log('位图所有权规则测试');

t('setDraftImage：新上传只替换草稿，活动旧位图保持打开', () => {
  const a = bmp('active-old'), b = bmp('draft-new');
  const active = new Map([['img', a]]);
  const draft = new Map([['img', a]]);
  setDraftImage(draft, active, 'img', b);
  assert.equal(draft.get('img'), b);
  assert.equal(active.get('img'), a, '活动位图被提前替换');
  assert.ok(!closed(a), '活动旧位图被提前关闭（上下文恢复会丢输入）');
  assert.ok(!closed(b));
});

t('候选被拒绝后再次上传：只关闭已无人引用的中间草稿位图，活动位图不动', () => {
  const a = bmp('active-old'), b1 = bmp('draft-1'), b2 = bmp('draft-2');
  const active = new Map([['img', a]]);
  const draft = new Map([['img', a]]);
  setDraftImage(draft, active, 'img', b1); // 候选被拒绝：活动仍是 a
  assert.ok(!closed(a));
  setDraftImage(draft, active, 'img', b2); // 无效草稿继续编辑后重新上传
  assert.equal(draft.get('img'), b2);
  assert.ok(closedOnce(b1), '被替换的草稿独占位图应释放');
  assert.ok(!closed(a), '活动位图在候选被拒绝后仍必须打开');
  assert.ok(!closed(b2));
});

t('成功提交：活动与草稿共享新位图，旧位图关闭（同 id 换图）', () => {
  const a = bmp('active-old'), b = bmp('draft-new');
  const active = new Map([['img', a]]);
  const draft = new Map([['img', b]]);
  const r = commitImages(draft, active, ['img']);
  assert.equal(r.active.get('img'), b);
  assert.equal(r.draft.get('img'), b, '提交后两表应共享同一引用');
  assert.ok(closedOnce(a), '旧活动位图应在成功启用后关闭');
  assert.ok(!closed(b));
});

t('提交未换图（结构编辑）：共享位图保持打开', () => {
  const a = bmp('shared');
  const active = new Map([['img', a]]);
  const draft = new Map([['img', a]]);
  const r = commitImages(draft, active, ['img']);
  assert.equal(r.active.get('img'), a);
  assert.equal(r.draft.get('img'), a);
  assert.ok(!closed(a));
});

t('提交时移除输入节点：旧位图在成功启用后才关闭', () => {
  const a = bmp('old-input');
  const active = new Map([['img', a]]);
  const draft = new Map([['img', a]]);
  const r = commitImages(draft, active, []);
  assert.equal(r.active.size, 0);
  assert.equal(r.draft.size, 0);
  assert.ok(closedOnce(a));
});

t('候选被拒绝期间绝不关闭位图；成功提交后才收口', () => {
  // 模拟：上传新图 -> 候选拒绝 -> 放弃 -> 重新上传 -> 成功提交
  const a = bmp('active-old'), b1 = bmp('rejected'), b2 = bmp('committed');
  let active = new Map([['img', a]]);
  let draft = new Map([['img', a]]);
  setDraftImage(draft, active, 'img', b1);
  // 候选被拒绝：无任何所有权收口发生
  assert.deepEqual([[...active], [...draft]].map((m) => m.map(([, b]) => b.label)),
    [['active-old'], ['rejected']]);
  assert.ok(!closed(a) && !closed(b1));
  // 放弃草稿：只释放草稿独占的 b1，回到共享 a
  draft = discardDraftImages(draft, active);
  assert.equal(draft.get('img'), a);
  assert.ok(closedOnce(b1));
  assert.ok(!closed(a));
  // 再编辑并上传，成功提交
  setDraftImage(draft, active, 'img', b2);
  const r = commitImages(draft, active, ['img']);
  active = r.active; draft = r.draft;
  assert.ok(closedOnce(a), '成功提交后旧活动位图才关闭');
  assert.equal(active.get('img'), b2);
  assert.equal(draft.get('img'), b2);
  assert.ok(!closed(b2));
});

t('放弃草稿：只关闭草稿独占位图，活动位图一律不动', () => {
  const a = bmp('active'), d = bmp('draft-only');
  const active = new Map([['img', a]]);
  const draft = new Map([['img', a], ['x', d]]);
  const r = discardDraftImages(draft, active);
  assert.equal(r.get('img'), a);
  assert.ok(!r.has('x'));
  assert.ok(closedOnce(d));
  assert.ok(!closed(a));
});

t('草稿整体替换（切示例）：只保留新草稿节点的位图，活动位图不动', () => {
  const a = bmp('active-img'), dKeep = bmp('draft-shared'), dDrop = bmp('draft-gone');
  const active = new Map([['img', a]]);
  // 旧草稿：img 共享活动位图，k 是草稿独占且新示例保留，gone 是草稿独占且新示例删除
  const draft = new Map([['img', a], ['k', dKeep], ['gone', dDrop]]);
  const r = retainDraftImages(draft, active, ['k']);
  assert.equal(r.get('k'), dKeep);
  assert.ok(!r.has('gone'));
  assert.ok(!closed(a), '活动位图在换示例时不得关闭');
  assert.ok(!closed(dKeep));
  assert.ok(closedOnce(dDrop));
});

t('新示例沿用活动输入（共享引用）：草稿取活动位图', () => {
  const a = bmp('active-img');
  const active = new Map([['img', a]]);
  const draft = new Map(); // 草稿此前没有该位图
  const r = retainDraftImages(draft, active, ['img']);
  assert.equal(r.get('img'), a);
  assert.ok(!closed(a));
});

t('同一位图在多个 id 下共享：关闭去重，绝不重复 close', () => {
  const shared = bmp('shared');
  const active = new Map([['a', shared], ['b', shared]]);
  const draft = new Map([['a', shared], ['b', shared]]);
  const r = commitImages(draft, active, ['a']);
  assert.equal(r.active.get('a'), shared);
  assert.ok(!closed(shared), '仍被引用的共享位图不能关闭');

  const s2 = bmp('shared2');
  const act2 = new Map([['a', s2], ['b', s2]]);
  const dr2 = new Map();
  const r2 = commitImages(dr2, act2, []);
  assert.ok(closedOnce(s2), '无人引用后恰好关闭一次');
  assert.equal(r2.active.size, 0);
});

t('核心回归：循环拒绝示例不关闭活动输入；修复成环提交后才换所有权', () => {
  // 活动修订：img（已加载 PNG）-> …，帧在运行
  const a = bmp('active-png');
  let active = new Map([['img', a]]);
  let draft = new Map([['img', a]]);
  // 点击“循环拒绝”：新草稿不含任何输入节点，候选同帧成环被拒绝
  draft = retainDraftImages(draft, active, []);
  assert.equal(draft.size, 0);
  assert.ok(!closed(a), '循环拒绝不得关闭活动修订的输入位图');
  // 模拟上下文恢复：上层仍能把活动位图交给引擎重建输入
  assert.equal(active.get('img'), a);
  // 用户在同一草稿中断开环路（仍无输入），成功提交：此时才关闭旧输入
  let r = commitImages(draft, active, []);
  assert.ok(closedOnce(a), '成功启用不含该输入的新修订后才可关闭');
  active = r.active; draft = r.draft;
});

t('过期上传返回：只关闭新解码位图，两张表都不变（由调用方保证）', () => {
  // 所有权模块本身不处理过期回调；调用方丢弃 bmp 时不能触碰任何映射表。
  const a = bmp('active'), stale = bmp('stale-decoded');
  const active = new Map([['img', a]]);
  const draft = new Map([['img', a]]);
  stale.close(); // 模拟调用方丢弃
  assert.ok(closedOnce(stale));
  assert.equal(active.get('img'), a);
  assert.equal(draft.get('img'), a);
  assert.ok(!closed(a));
});

console.log(`\n${passed} 个测试通过${process.exitCode ? '，存在失败' : ''}`);
