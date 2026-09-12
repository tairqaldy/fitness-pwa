# R12 — Phase-0 scaffold: Next.js 16.3.5 + TS strict + Tailwind v4.3 + shadcn/ui on Cloudflare

Researched 2026-09-12. Authority order: `docs/research/stack-facts.md` > `specs/00-brief.md` > this note.
Nothing here contradicts stack-facts.md. One finding **extends** it (see
[Open decision](#open-decision-for-the-owner)): Cloudflare's own tooling now defaults Next.js to a
different adapter (`vinext`), not OpenNext.

---

## Question

Pin down the exact Phase-0 scaffold commands and configs, verbatim, for:

1. the create command — `create-next-app` flags vs `npm create cloudflare` with the Next.js template,
   and which produces a better OpenNext-ready starter in 2026;
2. Tailwind v4 setup in Next 16 — `@tailwindcss/postcss` vs the Vite plugin, `postcss.config`, the
   single `@import "tailwindcss"` entry, and how a custom theme is declared in CSS with `@theme`
   (v4 has no `tailwind.config.js`), including the OLED-black + lime-accent token block;
3. shadcn/ui with Tailwind v4 + React 19 — current CLI command, `components.json`, whether a canary
   flag is still needed, and how the CSS-variables theme is wired in v4;
4. `tsconfig` for strict mode + the Cloudflare env types — how `wrangler types` generates
   `CloudflareEnv` / `worker-configuration.d.ts`, where to commit it, how it is regenerated;
5. ESLint 9 flat config for Next 16, and a Prettier setup that does not fight Tailwind class order;
6. a GitHub Actions CI workflow needing **no** Cloudflare credentials, plus how a deploy job
   authenticates and which `CLOUDFLARE_API_TOKEN` scopes Workers + D1 + R2 need.

---

## Verified answer

### 0. How this was verified — a real scaffold was built and run

Everything below was executed in the session scratchpad, not read off a blog. The full chain

```
create-next-app 16.3.5  ->  shadcn 4.21.0 init (radix base)  ->  strict tsconfig
  ->  wrangler 4.131.1 types  ->  eslint / prettier / vitest  ->  opennextjs-cloudflare build
```

completed successfully and produced `.open-next/worker.js`. Final resolved tree (`npm ls --depth=0`,
verbatim):

```
+-- @opennextjs/cloudflare@1.20.6
+-- @tailwindcss/postcss@4.3.3
+-- @types/node@24.13.4
+-- @types/react-dom@19.3.0
+-- @types/react@19.3.0
+-- class-variance-authority@0.7.1
+-- cn@0.3.0
+-- eslint-config-next@16.3.5
+-- eslint@9.39.5
+-- lucide-react@1.45.0
+-- next@16.3.5
+-- prettier-plugin-tailwindcss@0.8.1
+-- prettier@3.9.6
+-- radix-ui@1.6.7
+-- react-dom@19.2.8
+-- react@19.2.8
+-- shadcn@4.21.0
+-- tailwindcss@4.3.3
+-- tw-animate-css@1.4.0
+-- typescript@5.9.3
+-- vitest@5.0.0
`-- wrangler@4.131.1
```

Final gate, all green in that tree:

```
npx next build      -> "Compiled successfully" / "Running TypeScript" / "Finished TypeScript"
npx tsc --noEmit    -> exit 0
npx eslint . --max-warnings 0 -> exit 0
npx vitest run      -> Test Files 1 passed (1) / Tests 1 passed (1)
npx opennextjs-cloudflare build -> "Worker saved in `.open-next\worker.js`" / "OpenNext build complete."
```

Latest published versions read from the npm registry on 2026-09-12 (the ones stack-facts.md does not
already cover):

| Package | Latest | Note |
|---|---|---|
| `create-next-app` | 16.3.5 | tracks `next` |
| `create-cloudflare` (C3) | 2.72.7 | |
| `@tailwindcss/postcss` | 4.3.3 | matches `tailwindcss` 4.3.3 |
| `shadcn` (CLI + runtime) | 4.21.0 | |
| `eslint` | 10.10.0 | **do not use — see gotcha G6** |
| `eslint` (`maintenance` tag) | 9.39.5 | this is what we pin |
| `eslint-config-next` | 16.3.5 | peer `eslint: ">=9.0.0"` |
| `prettier` | 3.9.6 | |
| `prettier-plugin-tailwindcss` | 0.8.1 | engines `node >=20.19` |
| `typescript` | 7.0.2 | **native/Go port — do not use yet, gotcha G7** |
| `typescript` (5.x line) | 5.9.3 | this is what we pin |
| `radix-ui` | 1.6.7 | single-package Radix, what shadcn 4.x imports |
| `cn` | 0.3.0 | replaces `clsx` + `tailwind-merge` in shadcn 4.x |
| `tw-animate-css` | 1.4.0 | replaces `tailwindcss-animate` |
| `lucide-react` | 1.45.0 | |
| `react` / `react-dom` | 19.3.0 published; **19.2.8 is what create-next-app pins** | |
| `actions/checkout` | v7.0.1 | Cloudflare docs still show `@v6` |
| `actions/setup-node` | v7.0.0 | |
| `cloudflare/wrangler-action` | v4.0.0 | Cloudflare docs still show `@v3` |
| Node active LTS | 24.21.0 ("Krypton") | 26.8.2 is Current, **not** LTS |

Engine / peer constraints that bound the Node choice:

```
next@16.3.5                       engines: { "node": ">=20.9.0" }
wrangler@4.131.1                  engines: { "node": ">=22.0.0" }
prettier-plugin-tailwindcss@0.8.1 engines: { "node": ">=20.19" }
vitest@5.0.0                      peerOptional @types/node: "^22.0.0 || >=24.0.0"
@opennextjs/cloudflare@1.20.6     peerDependencies: {
                                    "next": ">=15.5.24 <16 || >=16.3.3",
                                    "wrangler": "^4.125.0",
                                    "rclone.js": "^0.6.6"   // peerDependenciesMeta: optional
                                  }
```

`next@16.3.5` satisfies OpenNext's `>=16.3.3`. **Node 24 is the floor and the CI version.**

---

### A. The create command — `create-next-app`, not C3

**This is the biggest change since the brief was written.** `npm create cloudflare --framework=next`
no longer means "OpenNext". Read verbatim from the shipped source of `create-cloudflare@2.72.7`
(`package/templates/next/c3.ts` inside the npm tarball):

```ts
type NextVariantValue = "vinext" | "opennext";

const VINEXT_TYPES_PATH = "./worker-configuration.d.ts";
const OPENNEXT_TYPES_PATH = "./cloudflare-env.d.ts";

const NEXT_VARIANTS: NextVariant[] = [
	{
		value: "vinext",
		label: "vinext (recommended)",
	},
	{
		value: "opennext",
		label: "OpenNext adapter",
	},
];
```

```ts
	const value = await inputPrompt({
		type: "select",
		question: "Which Next.js adapter do you want to use?",
		label: "variant",
		options: NEXT_VARIANTS,
		defaultValue: NEXT_VARIANTS[0].value,
		// Honour -y / --accept-defaults by taking the recommended vinext path.
		acceptDefault: Boolean(ctx.args.acceptDefaults),
	});
```

and the OpenNext branch:

```ts
async function generateOpenNext(ctx: C3Context) {
	// Easy way to switch branch for local testing
	const branch = "main";

	const repoUrl = `github:opennextjs/opennextjs-cloudflare/create-cloudflare/next#${branch}`;

	await downloadRemoteTemplate(repoUrl, {
		intoFolder: ctx.project.path,
	});

	await updatePackageName(ctx);
}
```

`--variant` *is* a real C3 flag (`package/dist/cli.js`, option list, verbatim):

```
    {
      name: "variant",
      type: "string",
      description: `The variant of the framework to use. This is only applicable for certain frameworks that support multiple variants (e.g. React with TypeScript, TypeScript + SWC, JavaScript, JavaScript + SWC).`,
      requiresArg: true
    },
```

So the OpenNext starter is reachable non-interactively:

```bash
npm create cloudflare@latest -- fitness-app-tair --framework=next --platform=workers --variant=opennext
```

**But it is the wrong choice for us**, for three verified reasons:

1. It downloads an **unpinned** template from the `main` branch of `opennextjs/opennextjs-cloudflare`.
   There is no version in the URL — a reproducible Phase 0 cannot depend on whatever `main` held today.
2. That template is already **behind our pins**. Its `package.json` on `main` today:
   `next 16.3.4`, `react`/`react-dom 19.1.7`, `@opennextjs/cloudflare 1.20.3`, `wrangler 4.125.0`,
   `typescript 5.7.4`, `eslint 9`, and a `"lint": "next lint"` script — `next lint` is gone in Next 16.
   We would immediately have to upgrade six pins and rewrite the lint script.
3. Cloudflare's own framework guide now reads
   *"As of 2026, Cloudflare recommends **vinext** as the standard approach for deploying Next.js
   applications to Workers"* — the adapter the brief and stack-facts.md do **not** use. Following C3's
   happy path silently lands us on vinext and invalidates every OpenNext fact in stack-facts.md
   (`.open-next/worker.js`, the four hardcoded cache binding names, `initOpenNextCloudflareForDev()`).

**Verified command sequence for Phase 0.** Run from the repo root; the project directory already exists,
so scaffold into a temp dir and move, or scaffold into `.` if the repo is empty.

```bash
# 1. Next 16.3.5 + TS + Tailwind v4 + ESLint flat config + src/ + @/* alias
npx create-next-app@16.3.5 fitness-app-tair \
  --ts --tailwind --eslint --app --src-dir --import-alias "@/*" \
  --use-npm --disable-git --yes

cd fitness-app-tair

# 2. shadcn/ui on the Radix primitive layer, Nova preset (Lucide icons + Geist)
npx shadcn@4.21.0 init -b radix -p nova -y --no-monorepo --css-variables

# 3. Cloudflare adapter + CLI
npm i @opennextjs/cloudflare@1.20.6
npm i -D wrangler@4.131.1

# 4. Tooling. @types/node MUST be bumped off create-next-app's ^20 first (gotcha G8)
npm i -D @types/node@^24 prettier@3.9.6 prettier-plugin-tailwindcss@0.8.1 vitest@5.0.0

# 5. Cloudflare env types (after wrangler.jsonc exists) — commit the output
npm run cf-typegen
```

`create-next-app@16.3.5 --help`, verbatim, for the flags that no longer exist or are new:

```
  --ts, --typescript                       Initialize as a TypeScript project. (default)
  --tailwind                               Initialize with Tailwind CSS config. (default)
  --react-compiler                         Initialize with React Compiler enabled.
  --eslint                                 Initialize with ESLint config.
  --biome                                  Initialize with Biome config.
  --app                                    Initialize as an App Router project.
  --src-dir                                Initialize inside a 'src/' directory.
  --rspack                                 Enable Rspack as the bundler.
  --import-alias <prefix/*>                Specify import alias to use (default "@/*").
  --agents-md                              Include AGENTS.md to guide coding agents to write up-to-date Next.js code. (default)
  --disable-git                            Skip initializing a git repository.
```

There is **no `--turbopack` flag** any more — Turbopack is the Next 16 default; `--rspack` is the opt-out.
`--agents-md` is on by default and writes `AGENTS.md` (and a `CLAUDE.md`) into the project root.

---

### B. Tailwind v4.3 in Next 16 — PostCSS plugin, not the Vite plugin

**Use `@tailwindcss/postcss`.** The Vite plugin (`@tailwindcss/vite`, also 4.3.3) is for Vite-based
builds; Next 16 with Turbopack consumes CSS through PostCSS, and `create-next-app --tailwind` already
wires the PostCSS plugin. The only reason we would touch `@tailwindcss/vite` is Vitest browser-mode
component tests, which Phase 0 does not have.

Official Tailwind Next.js install steps, verbatim:

```bash
npm install tailwindcss @tailwindcss/postcss postcss
```

```javascript
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
export default config;
```

```css
@import "tailwindcss";
```

`create-next-app` emits exactly this. **`postcss.config.mjs` — verbatim, unchanged, do not edit:**

```javascript
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
```

There is **no `tailwind.config.js`** and we must not create one. There is no `@tailwind base/components/utilities`
triple any more — one `@import "tailwindcss"` at the top of `src/app/globals.css` is the whole entry point.

**How a custom theme is declared.** From the official theme docs, the namespace → utility mapping
(verbatim table, trimmed to the namespaces we use):

| Namespace | Utility Classes |
|-----------|-----------------|
| `--color-*` | Color utilities like `bg-red-500`, `text-sky-300` |
| `--font-*` | Font family utilities like `font-sans` |
| `--text-*` | Font size utilities like `text-xl` |
| `--font-weight-*` | Font weight utilities like `font-bold` |
| `--tracking-*` | Letter spacing utilities like `tracking-wide` |
| `--leading-*` | Line height utilities like `leading-tight` |
| `--breakpoint-*` | Responsive breakpoint variants like `sm:*` |
| `--container-*` | Container query variants like `@sm:*` |
| `--spacing-*` | Spacing and sizing utilities like `px-4`, `max-h-16` |
| `--radius-*` | Border radius utilities like `rounded-sm` |
| `--shadow-*` | Box shadow utilities like `shadow-md` |
| `--ease-*` | Transition timing function utilities like `ease-out` |
| `--animate-*` | Animation utilities like `animate-spin` |

and on `@theme inline` (verbatim):

> When referencing other theme variables, use the `inline` option to resolve the variable value at
> declaration time.
>
> **Why this matters:** Without `inline`, CSS variable resolution happens where the variable is *used*,
> not where it's defined. This can cause unexpected fallbacks if referenced variables aren't defined in
> the same scope.

That is exactly the shape we need for a themeable dark/light palette: **raw hex in `:root` / `.dark`,
and `@theme inline` mapping `--color-x: var(--x)`.** If you write the hex directly inside a plain
`@theme` block, `dark:` never switches it.

Namespaces can also be wiped: `--color-*: initial;` inside `@theme` removes every stock Tailwind color,
and `--*: initial;` removes the whole default theme. **We do not do this** — shadcn components and
Recharts/visx helpers reach for stock utilities.

---

### C. `src/app/globals.css` — the OLED-black + lime token block (verbatim, verified compiling)

Every custom utility below was confirmed present in the compiled `.next/static/**/*.css` after
`next build`. Contrast ratios were computed from the hex values (WCAG 2.x formula) and are listed after
the file.

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";

@custom-variant dark (&:is(.dark *));

.dark {
  --background: #000000;
  --foreground: #f5f5f5;
  --surface-1: #0a0a0b;
  --surface-2: #121214;
  --surface-3: #1c1c20;
  --card: #0a0a0b;
  --card-foreground: #f5f5f5;
  --popover: #121214;
  --popover-foreground: #f5f5f5;
  --primary: #c6ff00;
  --primary-foreground: #0a0a0a;
  --secondary: #1c1c20;
  --secondary-foreground: #f5f5f5;
  --muted: #121214;
  --muted-foreground: #a1a1aa;
  --accent: #1c1c20;
  --accent-foreground: #f5f5f5;
  --destructive: #ff5449;
  --destructive-foreground: #0a0a0a;
  --warning: #ffb020;
  --success: #3ddc97;
  --border: #27272a;
  --input: #27272a;
  --ring: #c6ff00;
  --pr: #c6ff00;
  --chart-1: #c6ff00;
  --chart-2: #a5d400;
  --chart-3: #3ddc97;
  --chart-4: #ffb020;
  --chart-5: #a1a1aa;
  --radius: 1.25rem;
}

:root {
  --background: #ffffff;
  --foreground: #0a0a0a;
  --surface-1: #f5f5f5;
  --surface-2: #ebebeb;
  --surface-3: #e0e0e0;
  --card: #ffffff;
  --card-foreground: #0a0a0a;
  --popover: #ffffff;
  --popover-foreground: #0a0a0a;
  --primary: #4d6600;
  --primary-foreground: #ffffff;
  --secondary: #ebebeb;
  --secondary-foreground: #0a0a0a;
  --muted: #f5f5f5;
  --muted-foreground: #52525b;
  --accent: #ebebeb;
  --accent-foreground: #0a0a0a;
  --destructive: #b3261e;
  --destructive-foreground: #ffffff;
  --warning: #8a5a00;
  --success: #116b46;
  --border: #d4d4d8;
  --input: #d4d4d8;
  --ring: #4d6600;
  --pr: #4d6600;
  --chart-1: #4d6600;
  --chart-2: #6b8f00;
  --chart-3: #116b46;
  --chart-4: #8a5a00;
  --chart-5: #52525b;
  --radius: 1.25rem;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-surface-1: var(--surface-1);
  --color-surface-2: var(--surface-2);
  --color-surface-3: var(--surface-3);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-warning: var(--warning);
  --color-success: var(--success);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-pr: var(--pr);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);

  --font-sans: var(--font-app-sans);
  --font-mono: var(--font-app-mono);
  --font-numeric: var(--font-app-mono);

  --radius-sm: calc(var(--radius) * 0.4);
  --radius-md: calc(var(--radius) * 0.6);
  --radius-lg: calc(var(--radius) * 0.8);
  --radius-xl: var(--radius);
  --radius-card: var(--radius);
  --radius-sheet: calc(var(--radius) * 1.4);

  --spacing-tap: 3.5rem;
  --spacing-gym: 4.5rem;

  --text-readout: 2.75rem;
  --text-readout--line-height: 1;
  --text-readout--font-weight: 600;
  --text-readout--letter-spacing: -0.02em;

  --shadow-card: 0 1px 0 0 oklch(1 0 0 / 0.06), 0 8px 24px -12px oklch(0 0 0 / 0.6);
  --shadow-glow: 0 0 24px -4px oklch(0.9268 0.2313 124.41 / 0.45);

  --ease-spring: cubic-bezier(0.22, 1, 0.36, 1);
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  html {
    @apply font-sans;
    color-scheme: dark;
    -webkit-tap-highlight-color: transparent;
  }
  body {
    @apply bg-background text-foreground antialiased;
    overscroll-behavior-y: none;
  }
  .readout {
    @apply font-numeric text-readout tabular-nums;
    font-variant-numeric: tabular-nums slashed-zero;
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

**Compiled output proof** (grepped out of `.next/static/chunks/*.css` after `next build`):

```css
.bg-surface-1{background-color:var(--surface-1)}
.rounded-card{border-radius:var(--radius)}
.rounded-sheet{border-radius:calc(var(--radius) * 1.4)}
.text-pr{color:var(--pr)}
.text-chart-3{color:var(--chart-3)}
.text-readout{font-size:2.75rem;line-height:var(--tw-leading,1);letter-spacing:var(--tw-tracking,-.02em);font-weight:var(--tw-font-weight,600)}
.min-h-tap{min-height:3.5rem}
.p-tap{padding:3.5rem}
.size-gym{width:4.5rem;height:4.5rem}
.font-numeric{font-family:var(--font-app-mono)}
.font-sans{font-family:var(--font-app-sans)}
.ease-spring{--tw-ease:cubic-bezier(.22, 1, .36, 1);transition-timing-function:cubic-bezier(.22,1,.36,1)}
.shadow-glow{--tw-shadow:0 0 24px -4px var(--tw-shadow-color,#c6ff0073)}
```

Note `#c6ff0073` — the 45% alpha survived. It does **not** survive if you write the shadow with
`color-mix()`; see gotcha **G4**.

**Computed oklch equivalents** (for anyone who prefers shadcn's oklch house style — same colors):

```
#000000  oklch(0      0      0     )
#0a0a0b  oklch(0.1452 0.0021 286.13)
#121214  oklch(0.1831 0.0040 285.99)
#1c1c20  oklch(0.2282 0.0077 285.78)
#c6ff00  oklch(0.9268 0.2313 124.41)   <- electric lime, the single accent
#a5d400  oklch(0.8069 0.2008 124.18)
#f5f5f5  oklch(0.9702 0      89.88 )
#a1a1aa  oklch(0.7118 0.0129 286.07)
#27272a  oklch(0.2739 0.0055 286.03)
#ff5449  oklch(0.6795 0.2089 27.72 )
#ffb020  oklch(0.8131 0.1650 75.04 )
#3ddc97  oklch(0.7968 0.1636 159.69)
```

**Contrast ratios on the OLED canvas** (WCAG AA body text needs 4.5:1, AAA 7:1):

| Pair | Ratio | Verdict |
|---|---|---|
| `#c6ff00` on `#000000` | 17.71:1 | AAA |
| `#f5f5f5` on `#000000` | 19.26:1 | AAA |
| `#a1a1aa` on `#000000` | 8.19:1 | AAA |
| `#a1a1aa` on `#0a0a0b` | 7.72:1 | AAA |
| `#0a0a0a` on `#c6ff00` (ink on a lime CTA) | 16.69:1 | AAA |
| `#3ddc97` on `#000000` | 11.88:1 | AAA |
| `#ffb020` on `#000000` | 11.48:1 | AAA |
| `#ff5449` on `#000000` | 6.62:1 | AA (not AAA) |

The whole palette clears AA. Only `--destructive` misses AAA, which is fine for an error accent that is
never long-form body copy.

**Dark-first wiring.** shadcn generates `@custom-variant dark (&:is(.dark *))` — class-based, not
`prefers-color-scheme`. For a dark-first single-user app, put `dark` on `<html>` permanently and keep
`:root` as the light fallback so shadcn's many `dark:` variants stay meaningful.

---

### D. `src/app/layout.tsx` — fonts wired to the theme (verbatim)

```tsx
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const sans = Geist({ variable: "--font-app-sans", subsets: ["latin", "cyrillic"], display: "swap" });
const mono = Geist_Mono({ variable: "--font-app-mono", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "Fitness",
  description: "Personal training log",
};

export const viewport: Viewport = {
  themeColor: "#000000",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ru" className={`dark ${sans.variable} ${mono.variable} h-full`} suppressHydrationWarning>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
```

Two verified points:

- `LayoutProps<"/">` is a **global type generated by Next 16**, not an import. It only exists after route
  typegen — see gotcha **G1**.
- Geist covers Cyrillic, so RU is safe on one font family. Proof: `next/font/google`'s own types reject
  anything else — a deliberate bad subset produced
  `error TS2322: Type '"klingon"' is not assignable to type '"cyrillic" | "cyrillic-ext" | "latin" | "latin-ext" | "vietnamese"'.`
  and the built CSS contains `unicode-range:U+460-52F,...` and `unicode-range:U+301,U+400-45F,...` faces.

---

### E. shadcn/ui 4.21.0 with Tailwind v4 + React 19 — no canary, and a changed dependency story

**No canary flag, no `--force`, no `--legacy-peer-deps`.** `shadcn@4.21.0` detected everything on its own:

```
Verifying framework. Found Next.js.
Validating Tailwind CSS. Found v4.
Validating import alias.
Writing components.json.
Installing dependencies.
Updating fonts.
Created 1 file:
  - src\lib\utils.ts
Updating src\app\globals.css
```

The CLI surface has changed substantially from the 2.x era the brief was written against.
`shadcn init --help`, verbatim (trimmed):

```
Usage: shadcn init|create [options] [components...]

Options:
  -t, --template <template>  the template to use. (next, start, vite,
                             react-router, laravel, astro)
  -b, --base <base>          the component library to use. (base, radix, aria)
  --monorepo                 scaffold a monorepo project.
  --no-monorepo              skip the monorepo prompt.
  -p, --preset [name]        use a preset configuration
  -y, --yes                  skip confirmation prompt. (default: true)
  -d, --defaults             use default configuration: --template=next
                             --preset=base-nova (default: false)
  -f, --force                force overwrite of existing configuration.
  --css-variables            use css variables for theming. (default: true)
  --no-css-variables         do not use css variables for theming.
  --rtl                      enable RTL support.
  --pointer                  enable pointer cursor for buttons.
```

- There is **no `--base-color` flag any more**. `-b/--base` now picks the *primitive library*:
  `base` (Base UI), `radix`, or `aria` (React Aria). The brief says Radix → **`-b radix`**.
- `-p/--preset` is mandatory in practice. Valid values, read off the CLI's own error message:
  `nova, vega, maia, lyra, mira, luma, sera, rhea`. (`radix-nova` is **not** a valid `--preset`; the
  combined form `base-nova` seen in `-d`'s help text is the *default pair*, not a preset name.) `nova`
  is described in the interactive prompt as `Nova - Lucide / Geist`, which matches our brief's
  Geist + Lucide choice.
- `--css-variables` is already the default; passing it is belt-and-braces.

**`components.json` — verbatim as generated:**

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "radix-nova",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/app/globals.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "iconLibrary": "lucide",
  "rtl": false,
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "menuColor": "default",
  "menuAccent": "subtle",
  "registries": {}
}
```

`"tailwind.config": ""` is the v4 marker — an empty string, **not** a path, and **not** absent.
`style` is the composite `"<base>-<preset>"`.

**`src/lib/utils.ts` — verbatim as generated. This is a one-liner now:**

```ts
export { cn } from "cn"
```

shadcn 4.x no longer hand-rolls `clsx` + `tailwind-merge`; it re-exports the `cn` package (`cn@0.3.0`).
Components import from the single `radix-ui` package, e.g. the generated `button.tsx` header:

```tsx
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"
```

`init` also adds `shadcn` itself as a **runtime dependency**, because `globals.css` imports
`@import "shadcn/tailwind.css"` (resolved via the package's `"./tailwind.css": "./dist/tailwind.css"`
export). That file ships `@keyframes accordion-down/up`, `@custom-variant data-open/data-closed`, and
utilities like `no-scrollbar`, `scroll-fade-*`, `shimmer*`. **Do not move `shadcn` to devDependencies** —
the CSS build needs it resolvable.

**Theme wiring in v4** is entirely CSS-variables; there is no JS config to extend. shadcn's own migration
page states it verbatim: *"Full support for the new `@theme` directive"*, *"HSL colors are now converted to
OKLCH"*, migrate `tailwindcss-animate` → `tw-animate-css`, use `var(--chart-1)` rather than
`hsl(var(--chart-1))`, and components now carry `data-slot` attributes instead of `forwardRef`.

---

### F. `tsconfig.json` — strict, hardened, and verified to pass

Next 16 emits a deliberately loose tsconfig (`target: ES2017`, `allowJs: true`, no extra strict flags).
The hardened version below was run against the real scaffold (App Router page + layout + shadcn `button.tsx`
+ the 592 KB generated `cloudflare-env.d.ts`) and gave `tsc --noEmit` **exit 0**, and `next build`
**did not rewrite it** (byte-identical before/after — verified with `diff`).

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "jsx": "react-jsx",
    "incremental": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noPropertyAccessFromIndexSignature": true,
    "useUnknownInCatchVariables": true,
    "forceConsistentCasingInFileNames": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": [
    "next-env.d.ts",
    "cloudflare-env.d.ts",
    "**/*.ts",
    "**/*.tsx",
    ".next/types/**/*.ts",
    ".next/dev/types/**/*.ts",
    "**/*.mts"
  ],
  "exclude": ["node_modules", ".open-next"]
}
```

`skipLibCheck: true` is kept on purpose: `cloudflare-env.d.ts` inlines the entire workerd runtime
(15,399 lines / 592,138 bytes) and there is nothing to gain from type-checking it.

For reference, the untouched Next 16.3.5 default (verbatim) — note the differences:

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts", ".next/dev/types/**/*.ts", "**/*.mts"],
  "exclude": ["node_modules"]
}
```

`next-env.d.ts` in Next 16 is (verbatim) — note it now *imports* generated route types:

```ts
/// <reference types="next" />
/// <reference types="next/image-types/global" />
import "./.next/types/routes.d.ts";
import "./.next/types/root-params.d.ts";

// NOTE: This file should not be edited
// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.
```

---

### G. Cloudflare env types — `wrangler types` → `cloudflare-env.d.ts`, committed

`wrangler types --help`, verbatim:

```
wrangler types [path]

Generate types from your Worker configuration

POSITIONALS
  path  The path to the declaration file for the generated types  [string] [default: "worker-configuration.d.ts"]

OPTIONS
      --env-interface    The name of the generated environment interface  [string] [default: "Env"]
      --include-runtime  Include runtime types in the generated types  [boolean] [default: true]
      --include-env      Include Env types in the generated types  [boolean] [default: true]
      --strict-vars      Generate literal and union types for variables  [boolean] [default: true]
      --check            Check if the types at the provided path are up to date without regenerating them  [boolean]
```

So `worker-configuration.d.ts` is only the *default filename*. OpenNext's own docs and the OpenNext C3
template both use the interface name `CloudflareEnv` and the filename `cloudflare-env.d.ts`
(C3's source: `const OPENNEXT_TYPES_PATH = "./cloudflare-env.d.ts";` vs
`const VINEXT_TYPES_PATH = "./worker-configuration.d.ts";`). **We follow OpenNext:**

```json
"cf-typegen": "wrangler types --env-interface CloudflareEnv cloudflare-env.d.ts"
```

Running that against a realistic `wrangler.jsonc` produced this header — verbatim, with our actual bindings:

```ts
/* eslint-disable */
// Generated by Wrangler by running `wrangler types --env-interface=CloudflareEnv cloudflare-env.d.ts` (hash: 6929fb2a3d314c0abac2454eddce8f08)
// Runtime types generated with workerd@1.20260911.1 2026-09-01 global_fetch_strictly_public,nodejs_compat
interface __BaseEnv_CloudflareEnv {
	CACHE_KV: KVNamespace;
	PHOTOS: R2Bucket;
	NEXT_INC_CACHE_R2_BUCKET: R2Bucket;
	DB: D1Database;
	NEXT_TAG_CACHE_D1: D1Database;
	ASSETS: Fetcher;
	APP_TZ: "Asia/Almaty";
	AI_PROVIDER: "google";
	WORKER_SELF_REFERENCE: Fetcher /* fitness-app-tair */;
}
declare namespace Cloudflare {
	interface Env extends __BaseEnv_CloudflareEnv {}
}
interface CloudflareEnv extends __BaseEnv_CloudflareEnv {}
type StringifyValues<EnvType extends Record<string, unknown>> = {
	[Binding in keyof EnvType]: EnvType[Binding] extends string ? EnvType[Binding] : string;
};
declare namespace NodeJS {
	interface ProcessEnv extends StringifyValues<Pick<Cloudflare.Env, "APP_TZ" | "AI_PROVIDER">> {}
}

// Begin runtime types
...
```

Facts worth knowing:

- **Where it goes:** repo root, **committed**. It is a lockfile-class artifact: derived, but required for
  a green typecheck on a fresh clone. The OpenNext C3 template ships it as a tracked file and its
  `.gitignore` does not exclude it. 592 KB / 15,399 lines with `--include-runtime` (the default).
- **Three names, one shape:** the global `interface CloudflareEnv` (what `getCloudflareContext()` is typed
  against), `Cloudflare.Env` (what `import { env } from "cloudflare:workers"` uses), and
  `NodeJS.ProcessEnv` narrowed to the `vars` keys. You do not need a `types` array in tsconfig — the
  `**/*.ts` include picks it up; I added it explicitly to `include` anyway so the dependency is obvious.
- **How it is regenerated:** `npm run cf-typegen`, after **any** change to `wrangler.jsonc`
  (bindings, `vars`, `compatibility_date`, `compatibility_flags`). Wrangler prints
  `Remember to rerun 'wrangler types' after you change your wrangler.jsonc file.`
- **`--check` is the CI guard.** Verified empirically: unchanged config →
  `Types at cloudflare-env.d.ts are up to date.` exit **0**; after flipping one `vars` value →
  `X [ERROR] Types at cloudflare-env.d.ts are out of date. Run 'wrangler types' to regenerate.`
  and a **non-zero** exit (observed 127 on Windows; the exact code on Linux runners is UNVERIFIED, but it
  is non-zero, which is all CI needs). `--check` needs no Cloudflare credentials, so it belongs in the
  credential-free CI job.
- **`--strict-vars` defaults to true**, which is why `APP_TZ: "Asia/Almaty"` is a *literal* type, not
  `string`. Nice for safety, but it means committed types go stale on a one-character `vars` edit.

---

### H. `wrangler.jsonc`, `open-next.config.ts`, `next.config.ts`, `.dev.vars`

Consistent with stack-facts.md's OpenNext section; all four hardcoded binding names accounted for.
`compatibility_date` is set to `2026-09-01` (stack-facts requires `>= 2024-12-30`); the generated types
header confirms workerd honoured it: `Runtime types generated with workerd@1.20260911.1 2026-09-01`.
Placeholder ids below must be replaced with real ones from `wrangler d1 create` /
`wrangler kv namespace create`.

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "fitness-app-tair",
  "main": ".open-next/worker.js",
  "compatibility_date": "2026-09-01",
  "compatibility_flags": ["nodejs_compat", "global_fetch_strictly_public"],
  "assets": { "directory": ".open-next/assets", "binding": "ASSETS" },
  "observability": { "enabled": true },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "fitness-db",
      "database_id": "<REPLACE_ME>",
      "migrations_dir": "drizzle/migrations"
    },
    {
      "binding": "NEXT_TAG_CACHE_D1",
      "database_name": "fitness-db",
      "database_id": "<REPLACE_ME>"
    }
  ],
  "r2_buckets": [
    { "binding": "PHOTOS", "bucket_name": "fitness-photos" },
    { "binding": "NEXT_INC_CACHE_R2_BUCKET", "bucket_name": "fitness-cache" }
  ],
  "kv_namespaces": [{ "binding": "CACHE_KV", "id": "<REPLACE_ME>" }],
  "services": [{ "binding": "WORKER_SELF_REFERENCE", "service": "fitness-app-tair" }],
  "vars": { "APP_TZ": "Asia/Almaty", "AI_PROVIDER": "google" },
  "triggers": { "crons": ["0 3 * * *"] }
}
```

> The `NEXT_CACHE_DO_QUEUE` Durable Object binding (class `DOQueueHandler`) from stack-facts.md is
> **not** in the block above. It is only needed once we enable ISR/on-demand revalidation, and adding a
> DO namespace before it is used costs a migration entry. Phase 0 ships the R2 incremental cache + D1 tag
> cache; add the DO queue in the phase that first calls `revalidatePath`/`revalidateTag`. The
> `open-next.config.ts` below already wires `queue: doQueue`, so **either add the DO binding now or drop
> the `queue` line** — a mismatch is one of the silent-failure modes stack-facts.md warns about (G11).

`open-next.config.ts` (verified to build):

```ts
import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";
import doQueue from "@opennextjs/cloudflare/overrides/queue/do-queue";
import d1NextTagCache from "@opennextjs/cloudflare/overrides/tag-cache/d1-next-tag-cache";

export default defineCloudflareConfig({
  incrementalCache: r2IncrementalCache,
  queue: doQueue,
  tagCache: d1NextTagCache,
});
```

`next.config.ts` — the `initOpenNextCloudflareForDev()` call goes **after** the default export, which is
what OpenNext's docs show:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

export default nextConfig;

import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
void initOpenNextCloudflareForDev();
```

`.dev.vars` (git-ignored):

```
NEXTJS_ENV=development
```

---

### I. `package.json` — verbatim target for Phase 0

```json
{
  "name": "fitness-app-tair",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "typegen": "next typegen",
    "typecheck": "next typegen && tsc --noEmit",
    "lint": "eslint . --max-warnings 0",
    "lint:fix": "eslint . --fix",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "test": "vitest run",
    "test:watch": "vitest",
    "cf-typegen": "wrangler types --env-interface CloudflareEnv cloudflare-env.d.ts",
    "cf-typegen:check": "wrangler types --env-interface CloudflareEnv cloudflare-env.d.ts --check",
    "preview": "opennextjs-cloudflare build && opennextjs-cloudflare preview",
    "deploy": "opennextjs-cloudflare build && opennextjs-cloudflare deploy",
    "upload": "opennextjs-cloudflare build && opennextjs-cloudflare upload"
  },
  "dependencies": {
    "@opennextjs/cloudflare": "1.20.6",
    "class-variance-authority": "0.7.1",
    "cn": "0.3.0",
    "lucide-react": "1.45.0",
    "next": "16.3.5",
    "radix-ui": "1.6.7",
    "react": "19.2.8",
    "react-dom": "19.2.8",
    "shadcn": "4.21.0",
    "tw-animate-css": "1.4.0"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "4.3.3",
    "@types/node": "24.13.4",
    "@types/react": "19.3.0",
    "@types/react-dom": "19.3.0",
    "eslint": "9.39.5",
    "eslint-config-next": "16.3.5",
    "prettier": "3.9.6",
    "prettier-plugin-tailwindcss": "0.8.1",
    "tailwindcss": "4.3.3",
    "typescript": "5.9.3",
    "vitest": "5.0.0",
    "wrangler": "4.131.1"
  },
  "engines": {
    "node": ">=24.0.0"
  }
}
```

`preview` / `deploy` / `upload` are exactly the scripts OpenNext's docs prescribe. `lint` is plain
`eslint` — **`next lint` no longer exists in Next 16**; the generated script is `"lint": "eslint"`.

---

### J. ESLint 9 flat config for Next 16

`create-next-app@16.3.5` writes this (verbatim). The `eslint-config-next` subpath exports it uses —
`.`, `./core-web-vitals`, `./typescript`, `./parser` — were read off the installed `package.json`:

```javascript
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
```

`eslint-config-next@16.3.5` peers are `{"eslint": ">=9.0.0", "typescript": ">=3.3.1"}` and it bundles
`typescript-eslint@^8.46.0`, `eslint-plugin-react@^7.37.0`, `eslint-plugin-react-hooks@^7.0.0`,
`eslint-plugin-jsx-a11y@^6.10.0`, `eslint-plugin-import@^2.32.0`, `globals@16.4.0`.

**Our version, hardened.** The added ignores are not cosmetic — without them `eslint . --max-warnings 0`
**fails** (see gotcha G3):

```javascript
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Cloudflare / OpenNext generated output:
    ".open-next/**",
    ".wrangler/**",
    "cloudflare-env.d.ts",
    "worker-configuration.d.ts",
    // Drizzle generated SQL/meta:
    "drizzle/migrations/**",
    // shadcn vendored primitives - regenerated by the CLI, do not hand-lint:
    "src/components/ui/**",
  ]),
]);

export default eslintConfig;
```

> `src/components/ui/**` is a judgement call, not a requirement — it stops `shadcn add` churn from
> tripping our stricter rules. Drop it if you intend to own those files.

Verified: `npx eslint . --max-warnings 0` → exit **0** with this config on the scaffold.

---

### K. Prettier that does not fight Tailwind class order

`prettier-plugin-tailwindcss@0.8.1` supports Tailwind v4 via a **different option name** than v3.
From the plugin's own README, verbatim:

> When using Tailwind CSS v4 you must specify your CSS file entry point, which includes your theme,
> custom utilities, and other Tailwind configuration options. To do this, use the `tailwindStylesheet`
> option in your Prettier configuration.

`tailwindConfig` is the **v3** option and is inert for us (there is no config file). The full option set
in the shipped bundle: `tailwindStylesheet`, `tailwindConfig`, `tailwindEntryPoint`, `tailwindAttributes`,
`tailwindFunctions`, `tailwindPackageName`, `tailwindPreserveDuplicates`, `tailwindPreserveWhitespace`.

**`.prettierrc.json` — verbatim:**

```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "printWidth": 100,
  "plugins": ["prettier-plugin-tailwindcss"],
  "tailwindStylesheet": "./src/app/globals.css",
  "tailwindFunctions": ["cn", "cva", "clsx", "twMerge"]
}
```

**`.prettierignore` — verbatim:**

```
.next
.open-next
.wrangler
node_modules
package-lock.json
cloudflare-env.d.ts
worker-configuration.d.ts
drizzle/migrations
public
```

**Verified sorting, including our custom `@theme` utilities.** Because `tailwindStylesheet` points at
`globals.css`, the plugin knows about `min-h-touch`, `rounded-card`, `bg-surface-1`, `p-touch`, `text-pr`:

```tsx
// input
export const X = () => <div className={cn("text-pr p-touch bg-surface-1 flex rounded-card text-sm min-h-touch")} />;

// prettier output
export const X = () => (
  <div className={cn("flex min-h-touch rounded-card bg-surface-1 p-touch text-sm text-pr")} />
);
```

Correct Tailwind order (layout → box → color → typography), and it reached inside the `cn()` call.
`tailwindFunctions` is what makes that last part work.

**Do not add `eslint-plugin-prettier` or `eslint-config-prettier`.** `eslint-config-next` ships no
formatting rules that conflict, and running Prettier through ESLint would double every lint run.
Keep them as two separate CI steps.

---

### L. Vitest 5 — config and the alias

`vitest.config.mts` (note the `.mts` extension — see gotcha G9):

```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
```

Verified: a test importing `@/lib/e1rm` resolved and passed — `Test Files 1 passed (1) / Tests 1 passed (1)`.
Vitest does **not** read `tsconfig.json` `paths` on its own; the explicit `resolve.alias` is required.
`environment: "node"` is right for Phase 0 (pure calculators — Epley/Brzycki e1RM, plate math). Component
tests in a later phase will need `environment: "jsdom"` plus `jsdom` installed.

---

### M. `.gitignore` additions

`create-next-app` does not know about Cloudflare. Append exactly what the OpenNext C3 template has
(verbatim from that template's `.gitignore`):

```
# OpenNext
/.open-next

# wrangler files
.wrangler
.dev.vars*
```

and change the env line so the example file survives:

```
# env files (can opt-in for committing if needed)
.env*
!.env.example
```

**`cloudflare-env.d.ts` is deliberately NOT ignored** — it is committed.
`next-env.d.ts` **is** ignored by the default `.gitignore` (last line) and regenerated by `next typegen`.

---

### N. CI — `.github/workflows/ci.yml`, no Cloudflare credentials

Uses the current action versions (Cloudflare's docs still show `actions/checkout@v6`). Step order is
load-bearing: `next typegen` **must** run before `tsc --noEmit` (gotcha G1), and `cf-typegen:check`
verifies the committed env types without any secret.

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  verify:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    env:
      NEXT_TELEMETRY_DISABLED: "1"
      WRANGLER_SEND_METRICS: "false"
      CI: "true"
    steps:
      - uses: actions/checkout@v7

      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: npm

      - name: Install
        run: npm ci

      - name: Generate Next route types
        run: npm run typegen

      - name: Typecheck
        run: npx tsc --noEmit

      - name: Cloudflare env types are in sync
        run: npm run cf-typegen:check

      - name: Lint
        run: npm run lint

      - name: Format check
        run: npm run format:check

      - name: Unit tests
        run: npm run test

      - name: Build (Next)
        run: npm run build

      - name: Build (OpenNext worker)
        run: npx opennextjs-cloudflare build
```

Every step here is credential-free — including `opennextjs-cloudflare build`, which only bundles
(`Worker saved in .open-next/worker.js`); it does not contact Cloudflare. Only `deploy` / `preview` /
`upload` do.

`npm run typecheck` already chains `next typegen && tsc --noEmit`, so a single step would also work; it is
split above so a failure tells you *which* half broke.

---

### O. Deploy — `.github/workflows/deploy.yml` and the API token scopes

Wrangler reads credentials from the environment. From Cloudflare's system-environment-variables page,
verbatim:

- `CLOUDFLARE_API_TOKEN` — *"The API token for your Cloudflare account, can be used for authentication
  for situations like CI/CD, and other automation."*
- `CLOUDFLARE_ACCOUNT_ID` — *"The account ID for the Workers related account."*

Because our deploy is `opennextjs-cloudflare deploy` (which shells out to wrangler) rather than a bare
`wrangler deploy`, the simplest correct shape is plain env vars. `cloudflare/wrangler-action@v4` exists
and takes `apiToken` / `accountId` / `command` / `preCommands` / `postCommands` inputs, but wrapping an
OpenNext build in it buys nothing.

```yaml
name: Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: deploy-production
  cancel-in-progress: false

permissions:
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    timeout-minutes: 30
    env:
      NEXT_TELEMETRY_DISABLED: "1"
      WRANGLER_SEND_METRICS: "false"
      CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
      CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    steps:
      - uses: actions/checkout@v7

      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: npm

      - run: npm ci

      - name: Apply D1 migrations
        run: npx wrangler d1 migrations apply fitness-db --remote

      - name: Build and deploy worker
        run: npm run deploy
```

Cloudflare's GitHub Actions guide, verbatim, on the secret:

> **Important:** "Don't store the value of `CLOUDFLARE_API_TOKEN` in your repository, as it gives access
> to deploy Workers on your account."

Hence `environment: production` — a GitHub Environment gates the secret and can require manual approval.

**Token scopes.** Cloudflare's **"Edit Cloudflare Workers"** template contains, verbatim:

- "Workers Routes Write" (Zone resource)
- "Workers Scripts Write" (Account resource)
- "Workers KV Storage Write" (Account resource)
- "Workers Tail Read" (Account resource)
- "Workers R2 Storage Write" (Account resource)
- "Account Settings Read" (Account resource)
- "User Details Read" (User resource)
- "User Memberships Read" (User resource)

**That template does not include D1.** Our deploy job runs `wrangler d1 migrations apply --remote`, so
create the token from the template and then **add `D1 Edit` (Account scope)** by hand. The minimum set
for Workers + D1 + R2 in our pipeline:

| Permission | Scope | Why |
|---|---|---|
| Workers Scripts — Edit/Write | Account | upload & deploy the worker |
| Workers R2 Storage — Edit/Write | Account | `PHOTOS` + `NEXT_INC_CACHE_R2_BUCKET` |
| **D1 — Edit** | Account | `NEXT_TAG_CACHE_D1` + `wrangler d1 migrations apply --remote` — **not in the template** |
| Workers KV Storage — Edit/Write | Account | `CACHE_KV` |
| Account Settings — Read | Account | account / binding resolution |
| User Details — Read | User | wrangler auth / whoami |
| Memberships — Read | User | account list |
| Workers Tail — Read | Account | `wrangler tail` (optional, in the template) |
| Workers Routes — Write | Zone | only if a custom domain/route is attached; skip on `*.workers.dev` |

Scope **Account Resources** to the single account, and **Zone Resources** to the one zone (or omit the
Routes permission entirely while we are on `workers.dev`). The permission labels above are the exact
strings from Cloudflare's permissions reference (`Workers Scripts Read/Edit`, `Workers KV Storage
Read/Edit`, `Workers R2 Storage Read/Edit`, `D1 Read/Edit`, `Account Settings Read/Edit`,
`Memberships Read/Write`, `User Details Read/Write`).

---

## Recommendation

1. **Scaffold with `create-next-app@16.3.5`, not C3.** C3's Next.js template now defaults to `vinext`,
   and its OpenNext branch pulls an unpinned, already-stale template off `main`. Use the explicit command
   sequence in §A: `create-next-app` → `shadcn init -b radix -p nova` → `npm i @opennextjs/cloudflare`.
   Add the OpenNext files (`wrangler.jsonc`, `open-next.config.ts`, the `next.config.ts` tail,
   `.dev.vars`, the `.gitignore` block, the `cf-typegen` script) by hand from §H/§I/§M — they are short,
   and hand-writing them keeps every version under our control.
2. **Tailwind: `@tailwindcss/postcss` 4.3.3**, the untouched generated `postcss.config.mjs`, one
   `@import "tailwindcss"`, and **no `tailwind.config.js`, ever.**
3. **Theme: raw hex in `.dark` / `:root`, `@theme inline` mapping `--color-*: var(--*)`.** Use the block
   in §C verbatim; it compiles and every custom utility was confirmed in the output CSS. Put `dark` on
   `<html>` permanently and keep `:root` light so shadcn's `dark:` variants still mean something.
4. **shadcn: `shadcn@4.21.0 init -b radix -p nova -y --no-monorepo --css-variables`. No canary flag,
   no `--force`, no `--legacy-peer-deps`.** Accept the new dependency story (`cn`, `radix-ui`,
   `tw-animate-css`, `shadcn` as a runtime dep for `@import "shadcn/tailwind.css"`).
5. **TypeScript 5.9.3, not 7.0.2.** Use the hardened tsconfig in §F — it passes `tsc --noEmit` cleanly
   and `next build` does not rewrite it.
6. **ESLint 9.39.5, not 10.** Pin it exactly. ESLint 10 crashes with `eslint-config-next@16.3.5`.
7. **Prettier 3.9.6 + prettier-plugin-tailwindcss 0.8.1 with `tailwindStylesheet`** (not `tailwindConfig`)
   and `tailwindFunctions: ["cn", "cva", "clsx", "twMerge"]`. Two separate CI steps, no ESLint-Prettier
   bridge.
8. **Node 24 everywhere** — local, `engines`, and `actions/setup-node@v7` `node-version: 24`. Wrangler
   requires `>=22`, vitest's `@types/node` peer requires `^22 || >=24`, Node 24 is the active LTS.
9. **CI: `typegen → tsc → cf-typegen:check → lint → format:check → test → next build → opennext build`,
   zero secrets.** Deploy in a separate `environment: production` workflow with
   `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`; token = "Edit Cloudflare Workers" template **plus
   D1 Edit**.

Phase-0 DoD mapping: *deploys* → §O; *migration runs* → `wrangler d1 migrations apply` + `migrations_dir`
in §H; *page live* → §C/§D render on the worker; *docs exist* → this note plus the DECISIONS.md entries
listed below.

---

## Gotchas that will silently break us

**G1 — `tsc --noEmit` fails on a clean clone unless `next typegen` runs first.**
Next 16's generated `next-env.d.ts` does `import "./.next/types/routes.d.ts"`, and the generated layout
signature is `LayoutProps<"/">` — a *global* Next emits into `.next/types`. On a fresh checkout `.next`
does not exist. Reproduced verbatim:

```
$ rm -rf .next && npx tsc --noEmit
src/app/layout.tsx(20,50): error TS2304: Cannot find name 'LayoutProps'.
```

`npx next typegen` → `Types generated successfully` (writes
`.next/types/{routes,root-params,cache-life}.d.ts`) → `tsc --noEmit` exit 0. **Every CI typecheck step
must be preceded by `next typegen`.** `next build` also generates them, which is why "it works locally" —
locally you have a warm `.next`.

**G2 — `next lint` is gone.** Next 16's own scaffold uses `"lint": "eslint"`. Any doc, blog, or the
current OpenNext C3 template that says `next lint` is pre-16. The stale OpenNext template literally
ships `"lint": "next lint"`, which fails immediately.

**G3 — `eslint . --max-warnings 0` fails on the generated `cloudflare-env.d.ts`.**
The 592 KB generated file opens with `/* eslint-disable */`, and ESLint then reports its *inner*
`eslint-disable` comments as useless:

```
cloudflare-env.d.ts
  10644:44  warning  Unused eslint-disable directive (no problems were reported)
  10661:70  warning  Unused eslint-disable directive (no problems were reported)
2 problems (0 errors, 2 warnings)
```

Two warnings, zero errors — invisible until CI runs with `--max-warnings 0`, then red. Fix: the extended
`globalIgnores` in §J.

**G4 — Tailwind v4 silently destroys `color-mix()` alpha inside `--shadow-*`.**
Tailwind's shadow parser extracts the color and substitutes `var(--tw-shadow-color, <color>)`. It cannot
see through `color-mix()`, so it keeps only the *base* color and throws the percentage away. Verified:

```css
/* authored */
--shadow-glow: 0 0 24px -4px color-mix(in oklab, var(--primary) 45%, transparent);
/* compiled - the 45% is GONE, the glow is fully opaque */
.shadow-glow{--tw-shadow:0 0 24px -4px var(--tw-shadow-color,var(--primary))}

/* authored with a literal alpha instead */
--shadow-glow: 0 0 24px -4px oklch(0.9268 0.2313 124.41 / 0.45);
/* compiled - alpha preserved */
.shadow-glow{--tw-shadow:0 0 24px -4px var(--tw-shadow-color,#c6ff0073)}
```

An opaque lime glow on OLED black looks like a bug, and nothing warns you. **Always write theme shadow
colors with a literal alpha.** The same trap applies to `--inset-shadow-*` and `--drop-shadow-*`.
(This is also why §C hardcodes the lime's oklch instead of `var(--primary)` in the glow: the shadow value
is resolved at build time and cannot follow a runtime theme swap. Whether a future Tailwind release fixes
the `color-mix()` case is UNVERIFIED.)

**G5 — shadcn 4.21 writes a self-referential `--font-sans` and your font silently never applies.**
`init` emits, inside `@theme inline`:

```css
  --font-sans: var(--font-sans);
  --font-mono: var(--font-geist-mono);
```

while `layout.tsx` defines `--font-geist-sans`. Nothing defines `--font-sans`, so it points at itself.
Compiled proof:

```css
:root{ --font-sans:var(--font-sans); }
.font-sans{font-family:var(--font-sans)}
```

A `var()` cycle is invalid at computed-value time, so `font-family` falls back to inherited — the page
renders in the browser default and **no error appears anywhere**. Our §C/§D pair fixes it by naming the
`next/font` variables `--font-app-sans` / `--font-app-mono` and pointing `@theme inline` at those.
Confirmed working: `.font-sans{font-family:var(--font-app-sans)}`.

**G6 — ESLint 10 (`latest` on npm) hard-crashes with `eslint-config-next@16.3.5`.**
`eslint-config-next` bundles `eslint-plugin-react@7.37.5`, which has not been updated for ESLint 10's
rule context API:

```
ESLint: 10.10.0

TypeError: Error while loading rule 'react/display-name': contextOrFilename.getFilename is not a function
    at resolveBasedir (node_modules/eslint-config-next/node_modules/eslint-plugin-react/lib/util/version.js:31:100)
    at detectReactVersion (.../version.js:85:19)
```

Not a warning — no file gets linted at all. And `eslint-config-next`'s peer range is `">=9.0.0"`, so npm
happily installs ESLint 10. Meanwhile `npm i eslint@9.39.5` prints
`npm warn deprecated eslint@9.39.5: This version is no longer supported.` — **ignore that warning**;
9.39.5 is the `maintenance` dist-tag and the newest 9.x. Pin `"eslint": "9.39.5"` exactly.

**G7 — `typescript@latest` is now 7.0.2, the native Go compiler, and `typescript-eslint` refuses it.**
`typescript@7.0.2` ships platform binaries (`@typescript/typescript-win32-x64`, `-linux-x64`, …).
`typescript-eslint@8.70.0` declares `"typescript": ">=4.8.4 <6.1.0"`. `create-next-app` writes
`"typescript": "^5"` and resolves 5.9.3, which is correct — **do not "helpfully" upgrade to `latest`.**
Stable releases in between: `5.9.2, 5.9.3, 6.0.2, 6.0.3, 7.0.2`. 6.0.x would satisfy typescript-eslint's
range but is unproven against this stack — UNVERIFIED. Stay on 5.9.3 for Phase 0.

**G8 — `npm i vitest@5` fails outright against `create-next-app`'s `@types/node: "^20"`.**
Verbatim:

```
npm error ERESOLVE could not resolve
npm error While resolving: vitest@5.0.0
npm error Found: @types/node@20.19.43
npm error Could not resolve dependency:
npm error peerOptional @types/node@"^22.0.0 || >=24.0.0" from vitest@5.0.0
npm error Conflicting peer dependency: @types/node@22.20.2
```

The tempting fix (`--force` / `--legacy-peer-deps`) leaves you with Node 20 types against a Node 24
runtime. **Bump `@types/node` to `^24` first**, then install vitest — verified clean, and `tsc --noEmit`
still exits 0.

**G9 — `vitest.config.ts` triggers a Vite CJS-loader warning that will become an error.**
Verbatim:

```
(!) Your Vite config uses features that are unsupported by `configLoader: 'native'`, which is planned to
become the default in a future major version of Vite:
  - ESM syntax in a file loaded as CommonJS (vitest.config.ts:1:1). Use a `.mjs` extension or set
    "type": "module" in the closest package.json
```

Renaming to **`vitest.config.mts`** removes it and keeps tests passing (verified). Do not set
`"type": "module"` in `package.json` instead — that changes how Next resolves `next.config.ts`,
`postcss.config.mjs` and `eslint.config.mjs`, a much larger blast radius (whether Next 16 tolerates it is
UNVERIFIED).

**G10 — `--strict-vars` makes `cloudflare-env.d.ts` go stale on a one-character `vars` edit.**
It is on by default, so `"APP_TZ": "Asia/Almaty"` becomes the literal type `"Asia/Almaty"`. Change the
value in `wrangler.jsonc`, forget `npm run cf-typegen`, and the committed types now assert a value the
worker does not have. `npm run cf-typegen:check` in CI catches it — verified: clean →
`Types at cloudflare-env.d.ts are up to date.` exit 0; stale →
`X [ERROR] Types at cloudflare-env.d.ts are out of date.` and a non-zero exit.

**G11 — `open-next.config.ts` referencing `doQueue` without the `NEXT_CACHE_DO_QUEUE` Durable Object
binding.** stack-facts.md already flags that a typo in the four cache binding names is a *silent* cache
failure. The same is true of an override wired in code with no matching binding in `wrangler.jsonc`. The
`wrangler.jsonc` in §H deliberately omits the DO namespace, so **either add it or delete the `queue:`
line** before deploying.

**G12 — shadcn's default button is 32 px tall; the brief demands 56 px+ in GYM MODE.**
The generated `button.tsx` has `default: "h-8 gap-1.5 px-2.5 …"` and `lg: "h-9 …"` (plus `xs: "h-6"`,
`sm: "h-7"`, `icon: "size-8"`). Nothing in shadcn gets near a one-handed gym target. That is why §C
defines `--spacing-tap: 3.5rem` (56 px) and `--spacing-gym: 4.5rem` (72 px), giving `min-h-tap` /
`size-gym`. Add a `gym` size variant to `buttonVariants` in Phase 1 rather than sprinkling `min-h-tap` at
every call site.

**G13 — the `@import` order in `globals.css` is load-bearing.**
`@import "tailwindcss"` must come first, then `tw-animate-css`, then `shadcn/tailwind.css`, and only then
`@custom-variant` / `:root` / `@theme`. CSS `@import` rules must precede all other rules; putting a
`:root` block above them makes the imports invalid and Tailwind emits nothing — with no error.

**G14 — a nested lockfile makes Turbopack pick the wrong root.**
Next warned `Detected additional lockfiles` and inferred a root above the project. Harmless in a clean
repo; if it ever appears, set `turbopack: { root: ... }` in `next.config.ts` rather than deleting lockfiles.

---

## Open decision for the owner

**Decision: OpenNext vs vinext as the Cloudflare adapter.**

`specs/00-brief.md` and `docs/research/stack-facts.md` both specify `@opennextjs/cloudflare`, and
stack-facts.md is authoritative — so **this note builds on OpenNext 1.20.6 and everything above is
OpenNext-shaped.** I am not contradicting stack-facts.md; I am reporting that the ground moved after it
was written, because the difference is invisible if you follow Cloudflare's happy path.

What changed (verified 2026-09-12):

- Cloudflare's Next.js framework guide now reads: *"As of 2026, Cloudflare recommends **vinext** as the
  standard approach for deploying Next.js applications to Workers."*
- C3 2.72.7's Next template labels the options `vinext (recommended)` and `OpenNext adapter`, defaults to
  vinext, and `-y` silently takes vinext.
- The OpenNext path is described in C3's own source as the alternative and pulls an unpinned template
  from `main`.
- vinext uses different conventions: types at `./worker-configuration.d.ts` (not `cloudflare-env.d.ts`),
  `npm run dev:vinext` / `build:vinext`, `npx @vinext/cloudflare deploy`, and bindings via
  `import { env } from "cloudflare:workers"`.

**Option 1 — stay on OpenNext 1.20.6 (my recommendation).**
Everything in stack-facts.md stays valid: `.open-next/worker.js`, the four hardcoded cache binding names,
`initOpenNextCloudflareForDev()`, "no `export const runtime = "edge"`", the `preview`/`deploy` scripts.
Verified working end-to-end in this session with Next 16.3.5 and wrangler 4.131.1, and OpenNext's peer
range explicitly admits `next >=16.3.3`. Cost: we are on the path Cloudflare now calls the alternative,
so expect docs and search results to drift away from us, and expect a migration conversation later.

**Option 2 — switch Phase 0 to vinext.**
Aligns with Cloudflare's recommendation and its tooling defaults, and `npx vinext check` / `vinext init`
exist for non-destructive adoption. Cost: it **invalidates the entire OpenNext section of
stack-facts.md** and every research note downstream of it, and I have **not** verified vinext's maturity,
its D1/R2/KV binding ergonomics, its cache/ISR story, or its Serwist interaction. Its own docs list image
optimization as only *partially supported* — and the brief requires responsive AVIF via R2/Images.
All of that is UNVERIFIED.

**My recommendation: Option 1.** Phase 0 exists to get a deployable skeleton, and OpenNext is the adapter
our verified facts describe. Revisit after Phase 1 (Serwist/PWA), when we know how much of the Next
surface we actually lean on. Whichever you pick, **record it in `DECISIONS.md`** — the two adapters
disagree about the generated types filename, the deploy command, and the cache bindings, so a
half-migrated repo fails in confusing ways.

Two smaller decisions to record alongside it:

- **`NEXT_CACHE_DO_QUEUE` now or later** (G11). I recommend later, and dropping `queue: doQueue` from
  `open-next.config.ts` until the first `revalidateTag` call.
- **Lint shadcn's `src/components/ui/**` or ignore it** (§J). I recommend ignoring: those files are
  vendored and regenerated by `shadcn add`.

---

## Sources

**Local files read**

- `C:/Users/tairc/Documents/codespace/fitness-app-tair/specs/00-brief.md`
- `C:/Users/tairc/Documents/codespace/fitness-app-tair/docs/research/stack-facts.md`

**Package sources inspected directly (npm tarballs / installed `node_modules`)**

- `create-cloudflare@2.72.7` → `package/templates/next/c3.ts`, `package/templates/next/experimental_c3.ts`,
  `package/dist/cli.js` (the `--variant` / `--framework` / `--platform` option definitions)
- `eslint-config-next@16.3.5` → `package.json` (`exports`, `peerDependencies`, bundled plugin versions)
- `eslint-plugin-react@7.37.5` (bundled inside `eslint-config-next`) → the ESLint 10 crash site
  `lib/util/version.js`
- `shadcn@4.21.0` → `package.json` `exports` (`"./tailwind.css": "./dist/tailwind.css"`),
  `dist/tailwind.css`
- `prettier-plugin-tailwindcss@0.8.1` → `README.md`, `dist/index.mjs` (option names)
- `typescript@7.0.2` → `bin`, `optionalDependencies` (platform binaries)
- `typescript-eslint@8.70.0`, `vitest@5.0.0`, `next@16.3.5`, `@opennextjs/cloudflare@1.20.6`,
  `wrangler@4.131.1`, `drizzle-kit@0.31.10` → `peerDependencies` / `engines` / `peerDependenciesMeta`
  via `npm view`
- CLI help output: `create-next-app@16.3.5 --help`, `shadcn@4.21.0 init --help`,
  `shadcn@4.21.0 add --help`, `next --help`, `wrangler types --help`

**Official documentation**

- https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/ (and `…/index.md`) — the vinext default
- https://opennext.js.org/cloudflare/get-started — wrangler.jsonc, open-next.config.ts, scripts, `cf-typegen`
- https://tailwindcss.com/docs/installation/framework-guides/nextjs — install + postcss.config + `@import`
- https://tailwindcss.com/docs/theme — namespace table, `@theme inline`, `--color-*: initial`
- https://ui.shadcn.com/docs/installation/next
- https://ui.shadcn.com/docs/tailwind-v4 — oklch, `tw-animate-css`, `@theme inline`, `data-slot`
- https://developers.cloudflare.com/workers/languages/typescript/#generate-types
- https://developers.cloudflare.com/workers/wrangler/system-environment-variables/ — `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
- https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/ — workflow + token creation steps
- https://developers.cloudflare.com/workers/wrangler/ci-cd/
- https://developers.cloudflare.com/fundamentals/api/reference/permissions/ — permission names/scopes
- https://developers.cloudflare.com/fundamentals/api/reference/template/ — "Edit Cloudflare Workers" contents

**Repos / registries**

- https://github.com/opennextjs/opennextjs-cloudflare/tree/main/create-cloudflare/next — the C3 OpenNext
  remote template (`package.json`, `.gitignore`, `wrangler.jsonc`, file listing)
- https://api.github.com/repos/cloudflare/wrangler-action/releases/latest → v4.0.0 (2026-05-12)
- https://raw.githubusercontent.com/cloudflare/wrangler-action/v4.0.0/action.yml → inputs
- https://api.github.com/repos/actions/setup-node/releases/latest → v7.0.0
- https://api.github.com/repos/actions/checkout/releases/latest → v7.0.1
- https://nodejs.org/dist/index.json → LTS lines (Krypton v24.21.0 active LTS; v26.8.2 Current, not LTS)
