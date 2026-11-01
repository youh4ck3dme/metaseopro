module.exports = {
  ci: {
    collect: {
      startServerCommand: "npm run dev -- --host 127.0.0.1",
      startServerReadyPattern: "Local:",
      numberOfRuns: 1,
      url: ["http://127.0.0.1:5173/"],
    },
    assert: {
      preset: "lighthouse:recommended",
      assertions: {
        "categories:performance": ["error", { minScore: 1 }],
        "categories:accessibility": ["error", { minScore: 1 }],
        "categories:best-practices": ["error", { minScore: 1 }],
        "categories:seo": ["error", { minScore: 1 }],
        "installable-manifest": "error",
        "service-worker": "error",
      },
    },
    upload: { target: "temporary-public-storage" },
  },
};
