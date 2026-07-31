/** Standard list-response envelope (doc 03 — API conventions). */
export interface Paginated<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
  };
}

/** RFC-7807-style error shape returned by the API for all failures. */
export interface ApiErrorBody {
  statusCode: number;
  error: string;
  message: string;
  details?: Record<string, string[]>;
}
