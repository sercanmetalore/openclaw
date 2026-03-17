import type { ProjectPlanItem, ProjectPlanRecord, ProjectPlanStatus } from "./types.js";

type ItemIndex = {
  byId: Map<string, ProjectPlanItem>;
  childrenByParentId: Map<string, ProjectPlanItem[]>;
};

function buildItemIndex(items: ProjectPlanItem[]): ItemIndex {
  const byId = new Map<string, ProjectPlanItem>();
  const childrenByParentId = new Map<string, ProjectPlanItem[]>();
  for (const item of items) {
    byId.set(item.id, item);
    if (!item.parentId) {
      continue;
    }
    const siblings = childrenByParentId.get(item.parentId) ?? [];
    siblings.push(item);
    childrenByParentId.set(item.parentId, siblings);
  }
  for (const siblings of childrenByParentId.values()) {
    siblings.sort((a, b) => a.order - b.order);
  }
  return { byId, childrenByParentId };
}

function getDepth(
  item: ProjectPlanItem,
  byId: Map<string, ProjectPlanItem>,
  cache: Map<string, number>,
): number {
  const cached = cache.get(item.id);
  if (cached !== undefined) {
    return cached;
  }
  if (!item.parentId) {
    cache.set(item.id, 0);
    return 0;
  }
  const parent = byId.get(item.parentId);
  const depth = parent ? getDepth(parent, byId, cache) + 1 : 0;
  cache.set(item.id, depth);
  return depth;
}

function resolveContainerStatus(children: ProjectPlanItem[]): ProjectPlanStatus {
  if (children.length > 0 && children.every((child) => child.status === "done")) {
    return "done";
  }
  if (
    children.some((child) =>
      child.status === "in progress"
      || child.status === "done"
      || child.status === "blocked"
      || child.status === "failed",
    )
  ) {
    return "in progress";
  }
  return "to do";
}

export function recomputeContainerStatuses(plan: ProjectPlanRecord): boolean {
  const index = buildItemIndex(plan.items);
  const depthCache = new Map<string, number>();
  const containers = plan.items
    .filter((item) => index.childrenByParentId.has(item.id))
    .sort((a, b) => {
      const depthDiff = getDepth(b, index.byId, depthCache) - getDepth(a, index.byId, depthCache);
      return depthDiff || a.order - b.order;
    });

  let changed = false;
  for (const item of containers) {
    const children = index.childrenByParentId.get(item.id) ?? [];
    const nextStatus = resolveContainerStatus(children);
    if (item.status === nextStatus) {
      continue;
    }
    item.status = nextStatus;
    item.updatedAt = Date.now();
    changed = true;
  }
  return changed;
}

function isExecutableItem(
  item: ProjectPlanItem,
  index: ItemIndex,
): boolean {
  if (item.type === "epic") {
    return false;
  }
  if (item.type === "subtask") {
    return true;
  }
  return !index.childrenByParentId.has(item.id);
}

function hasCancelledAncestor(item: ProjectPlanItem, index: ItemIndex): boolean {
  let currentParentId = item.parentId;
  while (currentParentId) {
    const parent = index.byId.get(currentParentId);
    if (!parent) {
      break;
    }
    if (parent.status === "cancelled") {
      return true;
    }
    currentParentId = parent.parentId;
  }
  return false;
}

export function findNextExecutableItem(plan: ProjectPlanRecord): ProjectPlanItem | undefined {
  const index = buildItemIndex(plan.items);
  return [...plan.items]
    .sort((a, b) => a.order - b.order)
    .find((item) =>
      (item.status === "in progress" || item.status === "to do")
      && isExecutableItem(item, index)
      && !hasCancelledAncestor(item, index),
    );
}

export function hasOutstandingExecutableItems(plan: ProjectPlanRecord): boolean {
  const index = buildItemIndex(plan.items);
  return plan.items.some((item) => {
    if (!isExecutableItem(item, index)) {
      return false;
    }
    return item.status !== "done" && item.status !== "cancelled";
  });
}

function findNearestAncestorOfType(
  item: ProjectPlanItem,
  index: ItemIndex,
  type: ProjectPlanItem["type"],
): ProjectPlanItem | undefined {
  let currentParentId = item.parentId;
  while (currentParentId) {
    const parent = index.byId.get(currentParentId);
    if (!parent) {
      return undefined;
    }
    if (parent.type === type) {
      return parent;
    }
    currentParentId = parent.parentId;
  }
  return undefined;
}

export function buildExecutionContext(
  plan: ProjectPlanRecord,
  item: ProjectPlanItem,
): { task?: ProjectPlanItem; epic?: ProjectPlanItem } {
  const index = buildItemIndex(plan.items);
  if (item.type === "epic") {
    return { epic: item };
  }
  if (item.type === "task") {
    return {
      task: item,
      epic: findNearestAncestorOfType(item, index, "epic"),
    };
  }
  return {
    task: findNearestAncestorOfType(item, index, "task"),
    epic: findNearestAncestorOfType(item, index, "epic"),
  };
}
