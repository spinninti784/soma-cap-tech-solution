// New interfaces to make implementation cleaner

export interface Task {
  id: number;
  title: string;
  durationDays: number;
  dueDate?: string | null;
  imageUrl?: string | null;
  dependencies: number[];
  earliestStartDate?: Date;  // Changed from number to Date
  onCriticalPath?: boolean;
}

export interface Todo {
    id: number;
    title: string;
    createdAt: string;
    dueDate?: string | null;
    imageUrl?: string | null;
    durationDays: number;
    dependencies: number[];
    earliestStartDate?: Date;
}

