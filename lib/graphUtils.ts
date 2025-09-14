import type { Task } from './types';

export function hasCycle(tasks: Task[], startId: number, targetId: number, visited = new Set<number>()): boolean {
    if (startId === targetId) return true;
    if (visited.has(startId)) return false;
    visited.add(startId);
    
    const currentTask = tasks.find(t => t.id === startId);
    if (!currentTask) return false;
    
    return currentTask.dependencies.some(depId =>
        hasCycle(tasks, depId, targetId, visited)
    );
}