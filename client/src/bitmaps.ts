// bitmaps.ts —— 输入位图（ImageBitmap）在「草稿」与「活动修订」之间的所有权管理。
// 本文件不依赖 DOM / WebGL，可在 Node 中直接单元测试。
//
// 所有权规则：
// - 一张位图可能同时被两处引用：草稿（刚上传、尚未通过提交）与活动修订
//   （引擎正用它预览/导出，WebGL 上下文恢复时还要用它重建输入纹理）。
// - 位图只有在「草稿与活动修订都不再引用」时才允许 close()：
//   * 候选被拒绝 / 放弃草稿 / 过期上传返回时，活动修订的位图必须保持存活；
//   * 候选完整验证并成功启用后，才关闭不再被任一修订使用的旧位图；
//   * 放弃草稿时只释放草稿独占的位图，活动修订的位图不受影响。

import { Graph } from './graph.js';

export class BitmapStore {
  // 草稿视角：nodeId -> 位图。编辑器「已加载图像」、校验 hasImage、引擎输入纹理的来源。
  readonly draft = new Map<string, ImageBitmap>();
  // 活动修订视角：nodeId -> 位图。与引擎 inputTextures 持有的是同一批对象，
  // 只要活动修订还在运行（含上下文丢失待恢复），这些位图就必须保持可用。
  private active = new Map<string, ImageBitmap>();

  // 草稿获得一张位图（上传完成 / 示例图就绪）。
  // 被顶掉的旧位图若不再被活动修订引用，立即关闭；否则保留到它不再被使用。
  setDraft(id: string, bmp: ImageBitmap): void {
    const old = this.draft.get(id);
    this.draft.set(id, bmp);
    if (old && old !== bmp) this.releaseIfOrphan(old);
  }

  // 候选已完整验证并成功启用为新修订：活动视角切换为候选输入节点的当前草稿位图，
  // 此后才关闭不再被任一修订使用的旧活动位图。
  promote(candidate: Graph): void {
    const prev = this.active;
    this.active = new Map();
    for (const n of candidate.nodes) {
      if (n.type !== 'input') continue;
      const b = this.draft.get(n.id);
      if (b) this.active.set(n.id, b);
    }
    for (const bmp of new Set(prev.values())) this.releaseIfOrphan(bmp);
  }

  // 草稿不再包含的节点：移出其草稿条目；位图若仍被活动修订使用则保留，否则关闭。
  // 用于草稿被整体替换（示例）或成功提交后的收尾。
  retainDraft(g: Graph): void {
    for (const [id, bmp] of [...this.draft]) {
      if (!g.nodes.some((n) => n.id === id)) {
        this.draft.delete(id);
        this.releaseIfOrphan(bmp);
      }
    }
  }

  // 放弃草稿：草稿视角回滚到活动修订，只释放草稿独占的位图。
  revertToActive(): void {
    for (const [id, bmp] of [...this.draft]) {
      if (this.active.get(id) !== bmp) {
        this.draft.delete(id);
        this.releaseIfOrphan(bmp);
      }
    }
    for (const [id, bmp] of this.active) this.draft.set(id, bmp);
  }

  // 位图仍被草稿或活动修订引用时保留，两者都不用时才关闭。
  private releaseIfOrphan(bmp: ImageBitmap): void {
    for (const b of this.draft.values()) if (b === bmp) return;
    for (const b of this.active.values()) if (b === bmp) return;
    bmp.close();
  }
}
