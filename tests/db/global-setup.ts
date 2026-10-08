import { resetDatabase } from '../../packages/billing/src/testing';

/** Rebuilds the test database from the migrations once, before the database tests run. */
export default async function setup(): Promise<void> {
  await resetDatabase();
}
