// Lighthouse CI config. Run with `npm run lhci` against a running production
// build (`npm run build && npm start`). Override the target host with
// LHCI_BASE_URL (e.g. a preview deployment).
//
// SEO is a hard gate (the whole point of the SEO pass); accessibility,
// best-practices and performance are warnings so a slow CI runner / non-prod
// build doesn't red the pipeline. Tighten the perf budget once the production
// build + CDN are in place (see the SEO report's deploy notes).
const base = process.env.LHCI_BASE_URL || "http://localhost:3000";

module.exports = {
  ci: {
    collect: {
      url: [
        `${base}/`,
        `${base}/fleet`,
        `${base}/pricing`,
        `${base}/locations`,
        `${base}/contact`,
      ],
      numberOfRuns: 1,
    },
    assert: {
      assertions: {
        "categories:seo": ["error", { minScore: 0.95 }],
        "categories:accessibility": ["warn", { minScore: 0.9 }],
        "categories:best-practices": ["warn", { minScore: 0.9 }],
        "categories:performance": ["warn", { minScore: 0.6 }],
      },
    },
    upload: {
      target: "temporary-public-storage",
    },
  },
};
