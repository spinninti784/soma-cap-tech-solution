import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hasCycle } from '@/lib/graphUtils';
import type { Task } from '@/lib/types';

export async function GET() {
  try {
    const tasks = await prisma.task.findMany({
      orderBy: { createdAt: 'desc' },
    });

    const taskDeps = await prisma.taskDependency.findMany();
    const tasksWithDeps = tasks.map(task => ({
      ...task,
      dependencies: taskDeps
      .filter(dep => dep.taskId === task.id)
      .map(dep => dep.dependsOnId),
    }))
    return NextResponse.json(tasksWithDeps);
  } catch (error) {
    return NextResponse.json({ error: 'Error fetching todos' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { title, dueDate, durationDays, dependencies = [] } = await request.json();

    if (!title || title.trim() === '') {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }

    // Calculate durationDays from dueDate if not provided or invalid
    let calculatedDurationDays = 1;
    if (typeof durationDays === 'number' && durationDays > 0) {
      calculatedDurationDays = durationDays;
    } else if (dueDate) {
      const now = new Date();
      const due = new Date(dueDate);
      const diffMs = due.getTime() - now.getTime();
      const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      calculatedDurationDays = diffDays > 0 ? diffDays : 1; // minimum 1 day
    }

    // Fetch all existing tasks with dependencies for cycle detection
    const allTasks = await prisma.task.findMany({
      include: { dependsOn: true },
    });
    const formattedTasks: Task[] = allTasks.map(task => ({
      id: task.id,
      title: task.title,
      durationDays: task.durationDays,
      dependencies: task.dependsOn.map(dep => dep.dependsOnId),
    }));

    // Add new task with temporary negative ID for cycle detection
    const newTaskTempId = -1;
    const tasksIncludingNew = [...formattedTasks, {
      id: newTaskTempId,
      title,
      durationDays: calculatedDurationDays,
      dependencies,
    }];

    for (const depId of dependencies) {
      if (hasCycle(tasksIncludingNew, depId, newTaskTempId)) {
        return NextResponse.json({ error: 'Adding this dependency introduces a circular dependency.' }, { status: 400 });
      }
    }

    // Fetch image from pexels API
    let imageUrl = null;
    try {
      const response = await fetch(
        `https://api.pexels.com/v1/search?query=${encodeURIComponent(title)}&per_page=1`,
        {
          headers: { Authorization: process.env.PEXELS_API_KEY! },
        }
      );
      const data = await response.json();
      if (data.photos && data.photos.length > 0) {
        imageUrl = data.photos[0].src.medium;
      }
    } catch (err) {
      console.error('Error fetching image:', err);
    }

    // Create the task with calculated duration
    const createdTask = await prisma.task.create({
      data: {
        title,
        dueDate,
        durationDays: calculatedDurationDays,
        imageUrl,
      },
    });

    // Create entries in join table for each dependency
    if (dependencies.length > 0) {
      const dependencyRecords = dependencies.map((depId: number) => ({
        taskId: createdTask.id,
        dependsOnId: depId,
      }));
      await prisma.taskDependency.createMany({
        data: dependencyRecords,
      });
    }

    return NextResponse.json(createdTask, { status: 201 });
  } catch (error) {
    console.error('Error creating todo:', error);
    return NextResponse.json({ error: 'Error creating todo' }, { status: 500 });
  }
}