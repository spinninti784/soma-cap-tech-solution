"use client";
import React, { useState, useEffect, useRef } from "react";
import type { Task } from "@/lib/types";
import { Graph } from "@visx/network";

const nodeRadius = 28;
const nodeGapX = 180;
const nodeGapY = 90;
const layerOffsetX = 120; // horizontal shift per layer
const canvasPaddingLeft = 60;
const canvasPaddingTop = 60;
const background = "#f9fafb";

type TaskNode = {
  id: number;
  title: string;
  x: number;
  y: number;
  color?: string;
  critical?: boolean;
  earliestStartDate?: Date;
};

type TaskLink = {
  source: TaskNode;
  target: TaskNode;
  dashed?: boolean;
};

function parseDate(dateStr: string | null | undefined, fallback: Date): Date {
  if (!dateStr) return fallback;
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? fallback : d;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function computeTransitiveReduction(tasks: Task[]): Task[] {
  const taskMap = new Map(tasks.map(t => [t.id, t]));
  function isReachable(sourceId: number, targetId: number, skipEdge: [number, number]): boolean {
    if (sourceId === targetId) return true;
    const visited = new Set<number>();
    function dfs(current: number): boolean {
      if (current === targetId) return true;
      visited.add(current);
      const currentTask = taskMap.get(current);
      if (!currentTask) return false;
      for (const neighbor of currentTask.dependencies || []) {
        if (current === skipEdge[0] && neighbor === skipEdge[1]) continue;
        if (!visited.has(neighbor) && dfs(neighbor)) return true;
      }
      return false;
    }
    return dfs(sourceId);
  }
  return tasks.map(task => {
    const nonRedundantDeps = task.dependencies.filter(depId => {
      const otherDeps = task.dependencies.filter(d => d !== depId);
      return !otherDeps.some(otherDepId => isReachable(otherDepId, depId, [task.id, depId]));
    });
    return { ...task, dependencies: nonRedundantDeps };
  });
}

function calculateEarliestStartDates(tasks: Task[], projectStartDate: Date): Map<number, Date> {
  const taskMap = new Map(tasks.map(t => [t.id, t]));
  const memo = new Map<number, Date>();
  function getEarliestStartDate(taskId: number): Date {
    if (memo.has(taskId)) return memo.get(taskId)!;
    const task = taskMap.get(taskId);
    if (!task) return projectStartDate;
    if (!task.dependencies || task.dependencies.length === 0) {
      const ownDue = parseDate(task.dueDate, projectStartDate);
      memo.set(taskId, ownDue);
      return ownDue;
    }
    let maxParentDue = projectStartDate;
    for (const parentId of task.dependencies) {
      const parentTask = taskMap.get(parentId);
      const parentDue = parseDate(parentTask?.dueDate, projectStartDate);
      if (parentDue > maxParentDue) maxParentDue = parentDue;
    }
    memo.set(taskId, maxParentDue);
    return maxParentDue;
  }
  tasks.forEach(task => getEarliestStartDate(task.id));
  return memo;
}

function computeUpwardLayers(tasks: Task[]): Map<number, Task[]> {
  const childMap = new Map<number, number[]>();
  tasks.forEach(task => {
    task.dependencies?.forEach(depId => {
      if (!childMap.has(depId)) childMap.set(depId, []);
      childMap.get(depId)!.push(task.id);
    });
  });
  const heights = new Map<number, number>();
  function getHeight(id: number): number {
    if (heights.has(id)) return heights.get(id)!;
    const children = childMap.get(id) ?? [];
    if (children.length === 0) {
      heights.set(id, 0);
      return 0;
    }
    const h = 1 + Math.max(...children.map(getHeight));
    heights.set(id, h);
    return h;
  }
  tasks.forEach(t => getHeight(t.id));
  const layerGroups = new Map<number, Task[]>();
  tasks.forEach(t => {
    const h = heights.get(t.id) ?? 0;
    if (!layerGroups.has(h)) layerGroups.set(h, []);
    layerGroups.get(h)!.push(t);
  });
  return layerGroups;
}

function computeCriticalPath(tasks: Task[]): Set<number> {
  const layers = computeUpwardLayers(tasks);
  const criticalPath = new Set<number>();
  let previousCriticalTaskIds: number[] = [];
  const sortedLayers = Array.from(layers.entries()).sort(([a], [b]) => a - b);
  for (const [level, tasksAtLevel] of sortedLayers) {
    if (level === 0) {
      let maxES = new Date(0);
      let criticalTaskId: number | null = null;
      for (const task of tasksAtLevel) {
        if (task.earliestStartDate && task.earliestStartDate > maxES) {
          maxES = task.earliestStartDate;
          criticalTaskId = task.id;
        }
      }
      if (criticalTaskId !== null) criticalPath.add(criticalTaskId);
      previousCriticalTaskIds = criticalTaskId !== null ? [criticalTaskId] : [];
      continue;
    }
    const candidates = tasksAtLevel.filter(task =>
      previousCriticalTaskIds.some(critId =>
        tasks.find(t => t.id === critId)?.dependencies.includes(task.id)
      )
    );
    if (candidates.length === 0) {
      let maxES = new Date(0);
      let criticalTaskId: number | null = null;
      for (const task of tasksAtLevel) {
        if (task.earliestStartDate && task.earliestStartDate > maxES) {
          maxES = task.earliestStartDate;
          criticalTaskId = task.id;
        }
      }
      if (criticalTaskId !== null) criticalPath.add(criticalTaskId);
      previousCriticalTaskIds = criticalTaskId !== null ? [criticalTaskId] : [];
      continue;
    }
    let maxES = new Date(0);
    let criticalTaskId: number | null = null;
    for (const task of candidates) {
      if (task.earliestStartDate && task.earliestStartDate > maxES) {
        maxES = task.earliestStartDate;
        criticalTaskId = task.id;
      }
    }
    if (criticalTaskId !== null) criticalPath.add(criticalTaskId);
    previousCriticalTaskIds = criticalTaskId !== null ? [criticalTaskId] : [];
  }
  return criticalPath;
}

export default function Home() {
  const [newTodo, setNewTodo] = useState("");
  const [todos, setTodos] = useState<Task[]>([]);
  const [newDueDate, setNewDueDate] = useState("");
  const [newDependencies, setNewDependencies] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [imageLoadingIds, setImageLoadingIds] = useState<number[]>([]);
  const processedTodoIds = useRef<Set<number>>(new Set());

  useEffect(() => {
    fetchTodos();
  }, []);

  useEffect(() => {
    todos.forEach(todo => {
      if (
        todo.imageUrl &&
        !imageLoadingIds.includes(todo.id) &&
        !processedTodoIds.current.has(todo.id)
      ) {
        setImageLoadingIds(prev => [...prev, todo.id]);
        processedTodoIds.current.add(todo.id);
        setTimeout(() => {
          setImageLoadingIds(prev => prev.filter(id => id !== todo.id));
        }, 2000);
      }
    });
  }, [todos]);

  function isOverdue(dueDate?: string | null): boolean {
    if (!dueDate) return false;
    return new Date(dueDate) < new Date();
  }

  const fetchTodos = async () => {
    try {
      const res = await fetch("/api/todos");
      const data: Task[] = await res.json();
      const tasksNoRedundant = computeTransitiveReduction(data);
      const rootTasks = tasksNoRedundant.filter(t => !t.dependencies || t.dependencies.length === 0);
      const dueDates = rootTasks
        .map(t => t.dueDate)
        .filter(Boolean)
        .map(d => new Date(d!));
      const projectStartDate =
        dueDates.length > 0
          ? new Date(Math.min(...dueDates.map(d => d.getTime())))
          : new Date();
      const earliestStartMap = calculateEarliestStartDates(tasksNoRedundant, projectStartDate);
      const enrichedTasks = tasksNoRedundant.map(t => ({
        ...t,
        earliestStartDate: earliestStartMap.get(t.id),
      }));
      const criticalSet = computeCriticalPath(enrichedTasks);
      const finalTasks = enrichedTasks.map(t => ({
        ...t,
        onCriticalPath: criticalSet.has(t.id),
      }));
      setTodos(finalTasks);
    } catch (error) {
      console.error("Failed to fetch todos:", error);
    }
  };

  const handleAddTodo = async () => {
    if (!newTodo.trim()) return;
    const dueDateInput = newDueDate || null;
    const candidateId = todos.length > 0 ? Math.max(...todos.map(t => t.id)) + 1 : 1;
    const candidateTask: Task = {
      id: candidateId,
      title: newTodo,
      dueDate: dueDateInput,
      dependencies: newDependencies,
      durationDays: 1,
    };
    const tryTasks = computeTransitiveReduction([...todos, candidateTask]);
    const rootTasks = tryTasks.filter(t => !t.dependencies?.length);
    const rootDueDates = rootTasks
      .map(t => t.dueDate)
      .filter(Boolean)
      .map(d => new Date(d!));
    const projectStartDate =
      rootDueDates.length > 0
        ? new Date(Math.min(...rootDueDates.map(d => d.getTime())))
        : new Date();
    const esMap = calculateEarliestStartDates(tryTasks, projectStartDate);

    if (newDependencies.length > 0 && dueDateInput) {
      const candidateEarliestStart = esMap.get(candidateId);
      const due = parseDate(dueDateInput, new Date(0));
      if (candidateEarliestStart && due < candidateEarliestStart) {
        setError(
          `Due date ${dueDateInput} is before this task's earliest possible start date ` +
            `(${candidateEarliestStart.toISOString().slice(0, 10)}). Please pick a later due date.`
        );
        return;
      }
    }

    try {
      await fetch("/api/todos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTodo,
          dueDate: newDueDate || null,
          dependencies: newDependencies,
          durationDays: 1,
        }),
      });
      setNewTodo("");
      setNewDueDate("");
      setNewDependencies([]);
      setError(null);
      fetchTodos();
    } catch (error) {
      setError("Failed to add todo. Please try again.");
      console.error(error);
    }
  };

  const toggleDependency = (id: number) => {
    setNewDependencies(prev => (prev.includes(id) ? prev.filter(d => d !== id) : [...prev, id]));
  };

  const handleDeleteTodo = async (id: number) => {
    try {
      await fetch(`/api/todos/${id}`, { method: "DELETE" });
      fetchTodos();
    } catch (error) {
      console.error("Failed to delete todo:", error);
    }
  };

  // Diagonal layout: each layer shifts right and up
  const layers = computeUpwardLayers(todos);
  const nodeMap = new Map<number, TaskNode>();
  let maxX = 0,
    maxY = 0;

  const layerEntries = Array.from(layers.entries()).sort(([a], [b]) => a - b);

  layerEntries.forEach(([depth, layerTasks]) => {
    layerTasks.forEach((task, idx) => {
      // Diagonal layout: each layer moves right and up
      const x = canvasPaddingLeft + (depth * layerOffsetX) + (idx * nodeGapX);
      const y = canvasPaddingTop + (depth * nodeGapY);

      nodeMap.set(task.id, {
        id: task.id,
        title: task.title,
        x,
        y,
        color: task.onCriticalPath ? "#fee2e2" : "#bde0fe",
        critical: task.onCriticalPath,
        earliestStartDate: task.earliestStartDate,
      });

      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    });
  });

  const nodes = Array.from(nodeMap.values());
  const nodeLookup = new Map(nodes.map(n => [n.id, n]));
  const links: TaskLink[] = [];
  todos.forEach(t => {
    t.dependencies?.forEach(depId => {
      const source = nodeLookup.get(depId);
      const target = nodeLookup.get(t.id);
      if (source && target) {
        links.push({
          source,
          target,
          dashed: source.critical && target.critical,
        });
      }
    });
  });

  const svgWidth = Math.max(780, ...nodes.map(n => n.x + nodeRadius)) + canvasPaddingLeft;
  const svgHeight = Math.max(400, ...nodes.map(n => n.y + nodeRadius)) + canvasPaddingTop;

  return (
    <div className="min-h-screen bg-gradient-to-b from-orange-500 to-red-500 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-3xl">
        <h1 className="text-4xl font-bold text-center text-white mb-8">
          Things To Do App
        </h1>

        <svg width={svgWidth} height={svgHeight}>
          <rect width={svgWidth} height={svgHeight} rx={14} fill={background} />
          <Graph<TaskLink, TaskNode>
            graph={{ nodes, links }}
            nodeComponent={({ node }) => (
              <>
                <circle
                  r={nodeRadius}
                  fill={node.color}
                  stroke={node.critical ? "red" : "#2563eb"}
                  strokeWidth={3}
                />
                <text
                  x={0}
                  y={5}
                  textAnchor="middle"
                  fontWeight="bold"
                  fontSize={13}
                  fill="#374151"
                  style={{ pointerEvents: "none" }}
                >
                  {(node.earliestStartDate && new Date(node.earliestStartDate) < new Date() ? "[Exp] " : "") + node.title}
                </text>
              </>
            )}
            linkComponent={({ link }) => {
              const { x: x1, y: y1 } = link.source;
              const { x: x2, y: y2 } = link.target;

              const dx = x2 - x1;
              const dy = y2 - y1;
              const dist = Math.sqrt(dx * dx + dy * dy);
              const curveOffset = 70;

              // Control point for the quadratic Bezier curve
              const cx = x1 + dx / 2 + (dy / dist) * curveOffset;
              const cy = y1 + dy / 2 - (dx / dist) * curveOffset;

              const path = `M${x1},${y1} Q${cx},${cy} ${x2},${y2}`;

              // Point along the curve at t = 0.95 for arrow placement
              const t = 0.95;
              const xt = (1 - t) * (1 - t) * x1 + 2 * (1 - t) * t * cx + t * t * x2;
              const yt = (1 - t) * (1 - t) * y1 + 2 * (1 - t) * t * cy + t * t * y2;

              // Derivative of the quadratic Bezier at t (tangent vector)
              const dxdt = 2 * (1 - t) * (cx - x1) + 2 * t * (x2 - cx);
              const dydt = 2 * (1 - t) * (cy - y1) + 2 * t * (y2 - cy);

              // Angle to rotate the arrowhead
              const angle = Math.atan2(dydt, dxdt) * (180 / Math.PI);

              return (
                <>
                  <path
                    d={path}
                    fill="none"
                    stroke={link.dashed ? "red" : "#999"}
                    strokeWidth={2}
                    strokeDasharray={link.dashed ? "8 4" : undefined}
                    strokeLinecap="round"
                  />
                  <g transform={`translate(${xt},${yt}) rotate(${angle})`}>
                    <polygon points="0,-6 12,0 0,6" fill={link.dashed ? "red" : "#999"} />
                  </g>
                </>
              );
            }}
          />
          <defs>
            <marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto" markerUnits="strokeWidth">
              <path d="M0,0 L10,5 L0,10 L3,5 Z" fill="#999" />
            </marker>
          </defs>
        </svg>

        {error && (
          <div className="mt-4 mb-2 px-4 py-2 bg-red-100 text-red-800 rounded text-center font-semibold shadow">
            {error}
            <button
              onClick={() => setError(null)}
              className="ml-3 text-red-600 font-bold"
            >
              ×
            </button>
          </div>
        )}

        <div className="flex flex-col mb-6 gap-4 mt-8 relative">
          <input
            type="text"
            className="p-3 focus:outline-none text-gray-700 bg-white shadow flex-grow"
            placeholder="Add a new todo"
            value={newTodo}
            onChange={e => setNewTodo(e.target.value)}
          />
          <input
            type="date"
            className="p-3 border border-gray-300 focus:outline-none text-gray-700 bg-white shadow"
            value={newDueDate}
            onChange={e => setNewDueDate(e.target.value)}
          />
          <div className="max-h-40 overflow-auto bg-white border border-gray-300 rounded p-2 text-gray-700">
            <div className="font-semibold mb-1">Dependencies</div>
            {todos.length === 0 && (
              <div className="text-gray-500 text-sm">No tasks yet</div>
            )}
            {todos
              .filter(t => !t.dueDate || new Date(t.dueDate) >= new Date())
              .map(task => (
                <label key={task.id} className="cursor-pointer mb-1 flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={newDependencies.includes(task.id)}
                    onChange={() => toggleDependency(task.id)}
                  />
                  {task.title}
                  {task.dueDate && new Date(task.dueDate) < new Date() && (
                    <span className="ml-1 text-red-500 text-xs">(Past Due - Not selectable)</span>
                  )}
                </label>
              ))
            }
          </div>
          <button
            onClick={handleAddTodo}
            className="bg-orange-700 text-white p-3 hover:bg-orange-800 transition duration-300"
          >
            Add
          </button>
        </div>

        <ul>
          {todos.map(todo => (
            <li key={todo.id} className="flex items-center bg-white bg-opacity-90 p-4 mb-4 rounded-lg shadow-lg">
              <div className="w-20 h-20 flex-shrink-0 mr-4 rounded overflow-hidden bg-gray-200 flex items-center justify-center">
                {todo.imageUrl ? (
                  <img src={todo.imageUrl} alt={todo.title} className="w-full h-full object-cover" />
                ) : (
                  <span className="animate-pulse w-full h-full bg-gray-200 block rounded" />
                )}
              </div>
              <div className="flex flex-col flex-grow">
                <span className="text-gray-800 font-semibold">{todo.title}</span>
                {todo.dueDate && (
                  <span className={`mt-2 text-sm ${isOverdue(todo.dueDate) ? "text-red-500" : "text-gray-500"}`}>
                    Due: {todo.dueDate}
                  </span>
                )}
                {todo.dependencies.length > 0 && todo.earliestStartDate && (
                  <div className="mt-1 text-xs text-gray-600">
                    Earliest Start: {addDays(new Date(todo.earliestStartDate!), 1).toLocaleDateString()}
                  </div>
                )}
                {todo.onCriticalPath && (
                  <span className="mt-1 ml-2 px-2 py-0.5 rounded bg-red-600 text-white text-xs font-bold inline-block">
                    Critical Path
                  </span>
                )}
                {todo.dependencies && todo.dependencies.length > 0 && (
                  <span className="mt-1 text-xs text-gray-600">
                    Depends on:{" "}
                    {todo.dependencies
                      .map(depId => todos.find(t => t.id === depId)?.title || "(unknown)")
                      .join(", ")}
                  </span>
                )}
              </div>
              <button
                onClick={() => handleDeleteTodo(todo.id)}
                className="ml-4 text-red-500 hover:text-red-700 transition duration-300"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}