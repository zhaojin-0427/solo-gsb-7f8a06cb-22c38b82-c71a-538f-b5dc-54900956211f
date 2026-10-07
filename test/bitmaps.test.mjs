// bitmaps.test.mjs —— 位图所有权（草稿 / 活动修订双重视角）纯逻辑单元测试。
// 对应场景：候选被拒绝 / 放弃草稿 / 过期上传返回时活动修订位图必须存活；
// 候选成功启用后才关闭旧位图；放弃草稿只释放草稿独占位图。
// （先运行 npm run build；ImageBitmap 用带 close() 的假对象代替）
import assert from 'node:assert/strict';
import { BitmapStore } from '../client/dist/bitmaps.js';

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

function bmp(name) {
  return { name, closed: false, close() { this.closed = true; } };
}

// 构造只含给定节点 id 的"图"（retainDraft / promote 只关心节点集合与 input 类型）
function g(ids, type = 'input') {
  return {
    width: 64, height: 64, outputId: null,
    nodes: ids.map((id) => ({ id, type, x: 0, y: 0, params: {} })),
    edges: [],
  };
}

console.log('bitmaps 位图所有权测试');

t('草稿独占位图被新上传顶掉后立即关闭', () => {
  const s = new BitmapStore();
  const b1 = bmp('b1');
  const b2 = bmp('b2');
  s.setDraft('img', b1);
  s.setDraft('img', b2); // b1 从未提交，无任何修订引用
  assert.equal(b1.closed, true);
  assert.equal(b2.closed, false);
  assert.equal(s.draft.get('img'), b2);
});

t('无效草稿重新上传：活动位图不提前关闭，草稿保留新图', () => {
  const s = new BitmapStore();
  const b1 = bmp('b1');
  s.setDraft('img', b1);
  s.promote(g(['img'])); // r1 启用，活动修订用 b1
  const b2 = bmp('b2');
  s.setDraft('img', b2); // 草稿上传新图；随后候选被拒绝（不再 promote）
  assert.equal(b1.closed, false, '活动位图被提前关闭');
  assert.equal(b2.closed, false);
  assert.equal(s.draft.get('img'), b2, '无效草稿应保留新上传图片');
});

t('候选成功启用后才关闭不再被使用的旧活动位图', () => {
  const s = new BitmapStore();
  const b1 = bmp('b1');
  s.setDraft('img', b1);
  s.promote(g(['img']));
  const b2 = bmp('b2');
  s.setDraft('img', b2);
  assert.equal(b1.closed, false, '提交成功前旧位图就被关闭');
  s.promote(g(['img'])); // 新修订启用，活动视角切到 b2
  assert.equal(b1.closed, true, '旧活动位图未在新修订启用后关闭');
  assert.equal(b2.closed, false);
});

t('循环拒绝：草稿整体替换不关闭活动修订在用的位图', () => {
  const s = new BitmapStore();
  const b1 = bmp('b1');
  s.setDraft('img', b1);
  s.promote(g(['img'])); // 活动修订有 img -> b1
  s.retainDraft(g(['x', 'y'])); // 「循环拒绝」示例替换草稿，无 img 节点
  assert.equal(b1.closed, false, '活动修订位图被草稿替换关闭');
  assert.equal(s.draft.has('img'), false, '草稿视角不应再声称持有该位图');
});

t('草稿独占位图在草稿整体替换时关闭', () => {
  const s = new BitmapStore();
  const b1 = bmp('b1');
  s.setDraft('foo', b1); // 从未 promote，草稿独占
  s.retainDraft(g([]));
  assert.equal(b1.closed, true);
  assert.equal(s.draft.size, 0);
});

t('放弃草稿：只释放草稿独占位图，视图回滚到活动修订', () => {
  const s = new BitmapStore();
  const b1 = bmp('b1');
  const b2 = bmp('b2');
  const b3 = bmp('b3');
  s.setDraft('img', b1);
  s.promote(g(['img'])); // 活动：img -> b1
  s.setDraft('img', b2); // 草稿独占的新上传（候选被拒绝，未 promote）
  s.setDraft('tmp', b3); // 草稿独占的新节点
  s.revertToActive();
  assert.equal(b1.closed, false, '活动位图被放弃草稿关闭');
  assert.equal(b2.closed, true, '草稿独占位图未被释放');
  assert.equal(b3.closed, true, '草稿独占节点位图未被释放');
  assert.equal(s.draft.get('img'), b1, '草稿视图未回滚到活动修订的位图');
  assert.equal(s.draft.has('tmp'), false);
});

t('连续上传均未提交：中间的草稿独占图被关闭，活动图保留', () => {
  const s = new BitmapStore();
  const b1 = bmp('b1');
  const b2 = bmp('b2');
  const b3 = bmp('b3');
  s.setDraft('img', b1);
  s.promote(g(['img'])); // 活动用 b1
  s.setDraft('img', b2);
  s.setDraft('img', b3); // b2 被顶掉时已是草稿独占
  assert.equal(b1.closed, false, '活动位图被关闭');
  assert.equal(b2.closed, true, '草稿独占的中间位图未关闭');
  assert.equal(b3.closed, false);
});

t('删除节点后成功提交：位图在 promote + retainDraft 后关闭', () => {
  const s = new BitmapStore();
  const b1 = bmp('b1');
  s.setDraft('img', b1);
  s.promote(g(['img']));
  s.promote(g([])); // 新修订不含 img：promote 只切换活动视角，草稿仍引用 b1
  assert.equal(b1.closed, false);
  s.retainDraft(g([])); // 草稿也不再引用 -> 关闭
  assert.equal(b1.closed, true);
});

console.log(`\n${passed} 个测试通过${process.exitCode ? '，存在失败' : ''}`);
