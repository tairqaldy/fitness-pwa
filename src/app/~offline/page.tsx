import type { Metadata } from "next";

export const metadata: Metadata = { title: "Нет связи" };

/**
 * Offline fallback shell. MUST stay fully static — it is precached at build time and served by
 * the service worker when a navigation cannot reach the network, so it can never read D1.
 *
 * The tone is deliberately matter-of-fact rather than apologetic: losing signal in a basement
 * gym is the expected case, not an error, and logging keeps working while offline.
 */
export default function OfflinePage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-5 py-10 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Нет соединения</h1>
      <p className="text-muted-foreground text-balance">
        Эта страница ещё не сохранена для офлайна. Тренировку можно продолжать записывать — всё
        сохранится на телефоне и отправится, когда появится сеть.
      </p>
    </main>
  );
}
