# OED demos site

Lightweight static landing page + demos for optimal experiment design (OED), including a local-backend record linkage UI and a precomputed A/B heatmap walkthrough.

## Pages

- `index.html` – OED landing page + demo hub
- `data-linkage.html` – record linkage + deduplication UI (calls the backend API; intended for local use)
- `ab-oed.html` – adaptive A/B testing heatmap walkthrough (precomputed frames)
- `ab-test.html` – redirect alias to `ab-oed.html`
- `pricing.html` – pricing experiment placeholder page (upcoming)
- `survey.html` – adaptive survey placeholder page (upcoming)
- `style.css` – shared styling

## A/B heatmaps

`ab-oed.html` pages through precomputed PNG/SVG frames under `plots/` and (optionally) loads metadata from `plots/ab_oed_meta.json`.

## Running locally

From `FuzzyMatchingService` (local backend):

`julia --project=. server.jl`

Then open `http://localhost:8080`.

`server.jl` serves static files from the first directory it finds (in order):

- `../FuzzyMatchingWeb`
- `../josephsmiller.github.io/demos/oed`
- `./public` (inside `FuzzyMatchingService`)

If you host the HTML separately, set the API endpoint inside the UI to your backend base URL.

## Architecture

```
Frontend (static HTML)
    ↓ HTTP API calls
Backend (FuzzyMatchingService/server.jl)
    ↓ uses
FuzzyMatchingService (business logic)
    ↓ uses
MartingalePosteriors (core algorithm)
```

## Related Repositories

- **FuzzyMatchingService** - Backend API (https://github.com/millerjoey/FuzzyMatchingService)
- **MartingalePosteriors** - Core algorithm (https://github.com/millerjoey/MartingalePosteriors)

## License

Private repository - All rights reserved.
