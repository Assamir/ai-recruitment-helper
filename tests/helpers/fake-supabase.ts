/**
 * Ownership-enforcing Supabase test double.
 *
 * Models RLS by filtering analyses/candidates (and questions via analysis ownership)
 * to rows where user_id === actingUserId. job_profiles are shared (no user filter).
 *
 * This is NOT real RLS — see tests/rls/ for the gated source-of-truth lane.
 */

import { vi } from "vitest";

type Row = Record<string, unknown>;

export interface FakeSupabaseTables {
  analyses?: Row[];
  candidates?: Row[];
  analysis_questions?: Row[];
  job_profiles?: Row[];
}

export interface MakeFakeSupabaseOpts {
  actingUserId: string;
  tables: FakeSupabaseTables;
}

const NOT_FOUND = { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" };

function postgrestNotFound() {
  return { data: null, error: NOT_FOUND };
}

const USER_SCOPED_TABLES = new Set(["analyses", "candidates"]);

function ownedRows(table: string, rows: Row[], actingUserId: string): Row[] {
  if (!USER_SCOPED_TABLES.has(table)) return rows;
  return rows.filter((r) => r.user_id === actingUserId);
}

function ownedQuestions(rows: Row[], analyses: Row[], actingUserId: string): Row[] {
  const ownedAnalysisIds = new Set(analyses.filter((a) => a.user_id === actingUserId).map((a) => a.id as string));
  return rows.filter((r) => ownedAnalysisIds.has(r.analysis_id as string));
}

type ExecResult =
  | { data: Row | null; error: typeof NOT_FOUND | null }
  | { data: Row[] | null; error: null; count?: number }
  | { data: null; error: { message: string } | null; count?: number };

class Chain implements PromiseLike<ExecResult> {
  private filters: { col: string; val: unknown }[] = [];
  private orderCol: string | null = null;
  private countHead = false;

  constructor(
    private table: string,
    private allTables: FakeSupabaseTables,
    private actingUserId: string,
    private op: "select" | "delete" | "update" | "insert",
    private insertPayload?: Row | Row[],
    private updatePayload?: Row,
  ) {}

  select(_columns?: string, opts?: { count?: string; head?: boolean }) {
    if (opts?.count === "exact" && opts.head === true) this.countHead = true;
    return this;
  }

  eq(col: string, val: unknown) {
    this.filters.push({ col, val });
    return this;
  }

  order(col: string) {
    this.orderCol = col;
    return this;
  }

  private baseRows(): Row[] {
    const raw = this.allTables[this.table as keyof FakeSupabaseTables] ?? [];
    if (this.table === "analysis_questions") {
      return ownedQuestions(raw, this.allTables.analyses ?? [], this.actingUserId);
    }
    return ownedRows(this.table, raw, this.actingUserId);
  }

  private matched(): Row[] {
    let rows = this.baseRows();
    for (const { col, val } of this.filters) {
      rows = rows.filter((r) => r[col] === val);
    }
    if (this.orderCol) {
      const col = this.orderCol;
      rows = [...rows].sort((a, b) => {
        const av = a[col] as number | string;
        const bv = b[col] as number | string;
        return av < bv ? -1 : av > bv ? 1 : 0;
      });
    }
    return rows;
  }

  insert(payload: Row | Row[]) {
    return new Chain(this.table, this.allTables, this.actingUserId, "insert", payload);
  }

  update(payload: Row) {
    return new Chain(this.table, this.allTables, this.actingUserId, "update", undefined, payload);
  }

  delete() {
    return new Chain(this.table, this.allTables, this.actingUserId, "delete");
  }

  single(): Promise<{ data: Row | null; error: typeof NOT_FOUND | null }> {
    if (this.op === "insert" && this.insertPayload) {
      const row = Array.isArray(this.insertPayload) ? this.insertPayload[0] : this.insertPayload;
      const withId = { id: crypto.randomUUID(), ...row };
      const list = this.allTables[this.table as keyof FakeSupabaseTables] ?? [];
      list.push(withId);
      (this.allTables as Record<string, Row[]>)[this.table] = list;
      return Promise.resolve({ data: withId, error: null });
    }
    const rows = this.matched();
    if (rows.length !== 1) return Promise.resolve(postgrestNotFound());
    return Promise.resolve({ data: rows[0], error: null });
  }

  then<TResult1 = ExecResult, TResult2 = never>(
    onfulfilled?: ((value: ExecResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private execute(): Promise<ExecResult> {
    if (this.op === "delete") {
      const rows = this.matched();
      const key = this.table as keyof FakeSupabaseTables;
      const all = this.allTables[key] ?? [];
      const removeIds = new Set(rows.map((r) => r.id));
      (this.allTables as Record<string, Row[]>)[this.table] = all.filter((r) => !removeIds.has(r.id));
      return Promise.resolve({ data: null, error: null });
    }
    if (this.op === "update") {
      const rows = this.matched();
      for (const row of rows) Object.assign(row, this.updatePayload);
      return Promise.resolve({ data: null, error: null });
    }
    if (this.countHead) {
      return Promise.resolve({ data: null, error: null, count: this.matched().length });
    }
    return Promise.resolve({ data: this.matched(), error: null });
  }
}

export function makeFakeSupabase(opts: MakeFakeSupabaseOpts) {
  const { actingUserId, tables } = opts;

  return {
    from(table: string) {
      return {
        select: (columns?: string, opts?: { count?: string; head?: boolean }) =>
          new Chain(table, tables, actingUserId, "select").select(columns, opts),
        insert: (payload: Row | Row[]) => new Chain(table, tables, actingUserId, "insert", payload),
        update: (payload: Row) => new Chain(table, tables, actingUserId, "update", undefined, payload),
        delete: () => new Chain(table, tables, actingUserId, "delete"),
      };
    },
    auth: {
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
    },
  };
}
