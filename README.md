# CAIEcracker

Practice Cambridge O Level and AS & A Level past paper questions by subject, topic, year, session, paper and difficulty, with streaks, XP and progress tracking. An admin "question engine" scrapes past papers and turns them into a question bank automatically.

## Run it

```bash
npm install
cp .env.example .env      # add ANTHROPIC_API_KEY, admin login, session secret
npm run build             # builds the web app into dist/
npm start                 # http://localhost:3000
```

`npm run dev` runs the API and Vite with hot reload. Sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD` to reach **Admin**; students sign up themselves. All state (SQLite database, PDFs, question images) lives in `data/`.

## Question engine

Admin → Import: pick a subject, years and sessions. Each paper then goes through a checkpointed pipeline (`server/pipeline/`):

1. **Discover / download** (`sources.ts`) – probes component codes and downloads the question paper and mark scheme from several mirrors, validating that each file is a real PDF. PDFs can also be uploaded manually.
2. **Segment** (`pdf.ts`) – no AI. Uses the PDF text layer to find each question number, crops every question (and its mark scheme section) to images, and reads the MCQ answer key from the mark scheme table.
3. **Enrich** (`ai.ts`) – Claude transcribes each question (text + LaTeX), decides whether it needs its picture, classifies it into the subject's topic list, rates difficulty and writes the solution reasoning. Written-answer questions are split into parts with marks, marking points and a model answer. Output is schema-validated.
4. **Publish** – questions become available to students.

Reliability:

- Jobs sit in a durable SQLite queue (`queue.ts`): retried with backoff, resumed from the last finished stage after a restart.
- A question never depends on AI to be usable. If enrichment fails, is switched off, or the budget cap is hit, the question is served as its original image with the official answer / mark scheme, and can be enriched later ("Retry failed / finish image-only papers").
- Questions with no answer in the mark scheme, or where the AI disputes the official key, go to **Questions → Needs review** and stay hidden from students until approved.
- Papers that don't exist are marked `skipped`, not failed.

Cost controls (Admin → Overview): model, effort, a hard budget cap in USD, and a running spend total. Every API call is logged in `ai_usage`.

`npx tsx scripts/import-paper.ts 9702 2022 s 12` runs one paper through the pipeline from the command line.

## Known limits

- Scanned papers with no text layer (mostly pre-2003) cannot be segmented and are skipped.
- Papers that rely on inserts or source booklets (e.g. English, some Humanities) are imported without the insert.
- Past papers are Cambridge copyright; check you have the right to host them before going public.

## GitHub Pages (static site)

Pages can't run the server, so the public site is a static build: the question bank is exported to `web/public/bank/` (JSON + images) and student progress is stored in the browser (no accounts). The admin question engine still runs locally.

```bash
npm start                 # import / review papers in the admin dashboard
npm run export:static     # write the published bank to web/public/bank/
git add web/public/bank && git commit -m "Update question bank" && git push
```

`.github/workflows/pages.yml` builds with `npm run build:static` and deploys on every push. One-time setup: repo **Settings → Pages → Source: GitHub Actions**.
