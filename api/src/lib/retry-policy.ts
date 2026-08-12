/* ==========================================================================
   Which database errors may be tried again, and for which operations.

   Split out of prisma.ts so it can be tested without a database, a generated
   client, or a suspended Neon compute to reproduce against. It is a pure
   function of an error message and an operation name, which is exactly the
   kind of decision that should not need infrastructure to verify.
   ========================================================================== */

/**
 * The connection never carried the statement.
 *
 * Everything matched here means the socket was unusable *before* anything
 * ran, so a retry cannot repeat an effect: `P1001` could not reach the
 * server, `P1017` the server closed the connection, and `kind: Closed` is
 * Prisma discovering a dead connection in its own pool — which is what Neon's
 * autosuspend leaves behind.
 */
function connectionWasNeverUsable(message: string): boolean {
  return (
    /kind:\s*Closed/i.test(message) ||
    /\bP1001\b|\bP1017\b/.test(message) ||
    /Can't reach database server|Server has closed the connection/i.test(message)
  );
}

/**
 * The server hung up, possibly mid-statement.
 *
 * `E57P01` is what Postgres says when an administrator terminates a backend —
 * here, Neon suspending an idle compute. Usually the connection was idle and
 * nothing was lost. *Usually* is not good enough to replay a write: an
 * `INSERT` that committed and then lost its connection is indistinguishable
 * from one that never ran, and replaying it writes the row twice.
 */
function serverHungUp(message: string): boolean {
  return /E57P01|terminating connection due to administrator command/i.test(message);
}

/** Operations that can be repeated without changing anything. */
const READS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  // Raw reads go through the same hook. `$executeRaw` deliberately does not
  // appear here — it is a write by definition.
  '$queryRaw',
  '$queryRawUnsafe',
]);

export function isRetryable(message: string, operation: string): boolean {
  if (connectionWasNeverUsable(message)) return true;
  return serverHungUp(message) && READS.has(operation);
}
