import { describe, expect, it } from "vitest";
import { createItem, createPlan } from "./store.js";
import {
  buildExecutionContext,
  findNextExecutableItem,
  hasOutstandingExecutableItems,
  recomputeContainerStatuses,
} from "./execution.js";

describe("project-plan execution helpers", () => {
  it("marks task and epic done when all child items are done", () => {
    const plan = createPlan({ name: "Delivery" });
    const epic = createItem({ title: "Epic", type: "epic", order: 0 });
    const task = createItem({ title: "Task", type: "task", parentId: epic.id, order: 1 });
    const subtaskA = createItem({ title: "Subtask A", type: "subtask", parentId: task.id, order: 2 });
    const subtaskB = createItem({ title: "Subtask B", type: "subtask", parentId: task.id, order: 3 });

    subtaskA.status = "done";
    subtaskB.status = "done";
    plan.items = [epic, task, subtaskA, subtaskB];

    recomputeContainerStatuses(plan);

    expect(task.status).toBe("done");
    expect(epic.status).toBe("done");
  });

  it("executes subtasks before container tasks and epics", () => {
    const plan = createPlan({ name: "Delivery" });
    const epic = createItem({ title: "Epic", type: "epic", order: 0 });
    const groupedTask = createItem({ title: "Grouped task", type: "task", parentId: epic.id, order: 1 });
    const subtask = createItem({ title: "Subtask", type: "subtask", parentId: groupedTask.id, order: 2 });
    const standaloneTask = createItem({ title: "Standalone task", type: "task", order: 3 });
    plan.items = [epic, groupedTask, subtask, standaloneTask];

    expect(findNextExecutableItem(plan)?.id).toBe(subtask.id);

    subtask.status = "done";
    recomputeContainerStatuses(plan);

    expect(findNextExecutableItem(plan)?.id).toBe(standaloneTask.id);
  });

  it("includes parent task and epic context for subtasks", () => {
    const plan = createPlan({ name: "Delivery" });
    const epic = createItem({ title: "Epic", type: "epic", description: "Epic details", order: 0 });
    const task = createItem({ title: "Task", type: "task", description: "Task details", parentId: epic.id, order: 1 });
    const subtask = createItem({ title: "Subtask", type: "subtask", parentId: task.id, order: 2 });
    plan.items = [epic, task, subtask];

    const context = buildExecutionContext(plan, subtask);

    expect(context.task?.title).toBe("Task");
    expect(context.epic?.title).toBe("Epic");
  });

  it("detects unfinished executable items without treating grouped parents as work units", () => {
    const plan = createPlan({ name: "Delivery" });
    const epic = createItem({ title: "Epic", type: "epic", order: 0 });
    const task = createItem({ title: "Task", type: "task", parentId: epic.id, order: 1 });
    const subtask = createItem({ title: "Subtask", type: "subtask", parentId: task.id, order: 2 });
    plan.items = [epic, task, subtask];

    expect(hasOutstandingExecutableItems(plan)).toBe(true);

    subtask.status = "done";
    recomputeContainerStatuses(plan);

    expect(hasOutstandingExecutableItems(plan)).toBe(false);
  });

  it("selects earliest to-do item and skips failed/in-progress items", () => {
    const plan = createPlan({ name: "Resume" });
    const earlyFailed = createItem({ title: "Early failed", type: "task", order: 0 });
    const resumed = createItem({ title: "Resume me", type: "task", order: 1 });
    const laterTodo = createItem({ title: "Later todo", type: "task", order: 2 });
    earlyFailed.status = "failed";
    resumed.status = "in progress";
    laterTodo.status = "to do";
    plan.items = [earlyFailed, resumed, laterTodo];

    expect(findNextExecutableItem(plan)?.id).toBe(laterTodo.id);
  });

  it("returns undefined when no executable item is in to-do state", () => {
    const plan = createPlan({ name: "Retry" });
    const retried = createItem({ title: "Retried", type: "task", order: 0 });
    const current = createItem({ title: "Current", type: "task", order: 1 });
    retried.status = "failed";
    current.status = "in progress";
    plan.items = [retried, current];

    expect(findNextExecutableItem(plan)).toBeUndefined();
  });
});
