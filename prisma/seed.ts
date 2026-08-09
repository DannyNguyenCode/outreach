/**
 * Seed foundation for Phase 0.
 * Uses fake data only. Domain seeds belong to later phases.
 *
 * Run with: npx prisma db seed
 * (Configure seed in package.json prisma.seed when domain data exists.)
 */
async function main(): Promise<void> {
  console.log(
    "Phase 0 seed: no domain tables yet. Skipping fake-data inserts.",
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
