// ownership.ts —— 草稿 / 活动修订的 ImageBitmap 所有权规则（纯逻辑，不依赖 DOM/WebGL，可单测）。
//
// 两张映射表：
// - activeImages：当前活动修订各输入节点引用的位图。引擎在 WebGL 上下文恢复时要据此
//   重建输入纹理，因此只要位图仍被活动修订引用就绝不允许关闭。
// - draftImages：草稿各输入节点引用的位图。候选被拒绝（如同帧环）时草稿仍可继续编辑、
//   重新上传，因此草稿必须独立持有自己的位图；草稿与活动修订内容一致时两表共享同一引用。
//
// 唯一允许关闭位图的时机：它不再被活动修订与草稿中的任何一个引用（按对象身份判断）。
// 候选提交时，调用方必须先在引擎中完成完整验证并成功启用，再调用 commitImages 收口所有权。
// 过期上传返回时，调用方只关闭自己刚解码出的那张位图，两张表都不允许触碰。

export type InputImages = Map<string, ImageBitmap>;

// 草稿节点上传了新位图：替换草稿引用；被替换的旧位图只有在不被活动修订引用时才关闭。
// 活动修订引用的旧位图保持打开：即使候选随后被拒绝，预览/导出/上下文恢复仍然可用。
export function setDraftImage(
  draft: InputImages,
  active: InputImages,
  id: string,
  bmp: ImageBitmap,
): void {
  const old = draft.get(id);
  draft.set(id, bmp);
  if (old && !new Set(active.values()).has(old)) old.close();
}

// 草稿被整体替换（切换内置示例）：保留新草稿中仍存在的节点位图（优先取草稿自身的，
// 其次与活动修订共享），关闭仅被旧草稿引用的位图；活动修订引用的位图一律不动。
export function retainDraftImages(
  draft: InputImages,
  active: InputImages,
  keepIds: Iterable<string>,
): InputImages {
  const activeSet = new Set(active.values());
  const next: InputImages = new Map();
  for (const id of keepIds) {
    const b = draft.get(id) ?? active.get(id);
    if (b) next.set(id, b);
  }
  const nextSet = new Set(next.values());
  // 同一位图可能在多个 id 下共享，按去重后的对象集合关闭，保证每张至多关闭一次
  for (const b of new Set(draft.values())) {
    if (!nextSet.has(b) && !activeSet.has(b)) b.close();
  }
  return next;
}

// 放弃草稿：草稿位图表回到与活动修订共享同一组引用；只关闭草稿独占的位图。
export function discardDraftImages(draft: InputImages, active: InputImages): InputImages {
  const activeSet = new Set(active.values());
  const next: InputImages = new Map(active);
  for (const b of new Set(draft.values())) {
    if (!activeSet.has(b)) b.close();
  }
  return next;
}

// 候选已完整验证并在引擎中成功启用后调用：活动修订采用草稿位图，两表对候选中的输入节点
// 共享同一引用；关闭此前被活动/草稿引用、现在已不被任一修订使用的旧位图。
export function commitImages(
  draft: InputImages,
  active: InputImages,
  inputIds: Iterable<string>,
): { active: InputImages; draft: InputImages } {
  const keep = new Set(inputIds);
  const nextActive: InputImages = new Map();
  for (const id of keep) {
    const b = draft.get(id) ?? active.get(id);
    if (b) nextActive.set(id, b);
  }
  const nextDraft: InputImages = new Map();
  for (const id of keep) {
    const b = draft.get(id) ?? nextActive.get(id);
    if (b) nextDraft.set(id, b);
  }
  const keptActive = new Set(nextActive.values());
  const keptDraft = new Set(nextDraft.values());
  // 对旧两表引用的并集统一收口：不在任一新表中的位图恰好关闭一次
  // （活动循环与草稿循环分开关闭会把同一旧位图关闭两次）
  const stale = new Set<ImageBitmap>([...active.values(), ...draft.values()]);
  for (const b of stale) {
    if (!keptActive.has(b) && !keptDraft.has(b)) b.close();
  }
  return { active: nextActive, draft: nextDraft };
}
