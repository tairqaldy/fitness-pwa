import { sql } from "drizzle-orm";

import { getDb } from "@/server/db";

/**
 * Phase 0 landing page. Deliberately reads D1 so that a successful production render is
 * itself proof the binding, the migration and the drizzle client all work. Replaced by the
 * real dashboard in Phase 6.
 */
export const dynamic = "force-dynamic";

export default async function Home() {
  const db = getDb();
  const tables = await db.all<{ name: string }>(
    sql`select name from sqlite_master where type='table' and name not like 'sqlite_%' and name not like '_cf%' order by name`,
  );

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-5 py-10">
      <header className="flex flex-col gap-2">
        <p className="text-muted-foreground text-sm font-medium tracking-widest uppercase">
          Фаза 0 · каркас
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">Форма</h1>
        <p className="text-muted-foreground text-balance">
          Личный дневник тренировок, питания и прогресса. Приложение разворачивается — функции
          появятся по фазам.
        </p>
      </header>

      <section className="bg-card shadow-card rounded-card border p-5">
        <h2 className="text-muted-foreground mb-3 text-xs font-medium tracking-widest uppercase">
          База данных
        </h2>
        <p className="readout text-primary">{tables.length}</p>
        <p className="text-muted-foreground mt-1 text-sm">таблиц в D1 · регион EEUR</p>
        <ul className="mt-4 flex flex-wrap gap-2">
          {tables.map((t) => (
            <li
              key={t.name}
              className="bg-surface-2 text-foreground/80 rounded-md px-2.5 py-1 font-mono text-xs"
            >
              {t.name}
            </li>
          ))}
        </ul>
      </section>

      <section className="bg-card shadow-card rounded-card border p-5">
        <h2 className="text-muted-foreground mb-3 text-xs font-medium tracking-widest uppercase">
          Проверка систем
        </h2>
        <a
          href="/api/health"
          className="bg-primary text-primary-foreground min-h-tap focus-visible:ring-ring inline-flex w-full items-center justify-center rounded-xl px-5 font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          Открыть /api/health
        </a>
        <p className="text-muted-foreground mt-3 text-sm">
          Проверяет D1, R2, KV и миграции прямо в продакшене.
        </p>
      </section>
    </main>
  );
}
