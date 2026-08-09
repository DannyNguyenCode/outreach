/**
 * Seed foundation for Phase 0 only.
 * Prisma seeding is not configured yet (no package.json prisma.seed entry).
 * There are no Phase 0 domain models or seed records.
 * Configure seeding in a later phase when fake development data is introduced.
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
