import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://iwigztspqhrujaskpobn.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml3aWd6dHNwcWhydWphc2twb2JuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3NjM3MDIsImV4cCI6MjA5MjMzOTcwMn0.Z0-gnznE9lBAlQJzD02J5cei5a_VtOZnGhSAq82hWgQ';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Helper to generate a cuid-like ID
export function generateId(): string {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 10);
  return `c${timestamp}${randomPart}`;
}

// Helper to format dates for Supabase
export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

// Convert snake_case from Supabase to camelCase for frontend
export function toCamelCase<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    result[camelKey] = value;
  }
  return result;
}

// Convert camelCase from frontend to snake_case for Supabase
export function toSnakeCase<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const snakeKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
    result[snakeKey] = value;
  }
  return result;
}
