import { describe, expect, it } from "vitest";
import { pgConnectionString } from "@/server/jobs/db-backup";

describe("pgConnectionString", () => {
  it("strips Prisma-only pool params that pg_dump/libpq reject", () => {
    const out = pgConnectionString(
      "postgresql://postgres:pw@localhost:5532/xpertmoto?connection_limit=10&pool_timeout=20",
    );
    expect(out).not.toContain("connection_limit");
    expect(out).not.toContain("pool_timeout");
    // The core DSN survives intact.
    expect(out).toContain("postgresql://postgres:pw@localhost:5532/xpertmoto");
  });

  it("strips the other Prisma-only params (pgbouncer, socket_timeout, schema)", () => {
    const out = pgConnectionString(
      "postgresql://u:p@host:5432/db?pgbouncer=true&socket_timeout=5&schema=public",
    );
    expect(out).not.toContain("pgbouncer");
    expect(out).not.toContain("socket_timeout");
    expect(out).not.toContain("schema=");
  });

  it("preserves libpq-understood params such as sslmode", () => {
    const out = pgConnectionString(
      "postgresql://u:p@host:5432/db?sslmode=require&connection_limit=10",
    );
    expect(out).toContain("sslmode=require");
    expect(out).not.toContain("connection_limit");
  });

  it("is a no-op for a URL with no query string", () => {
    const url = "postgresql://u:p@host:5432/db";
    expect(pgConnectionString(url)).toBe(url);
  });

  it("returns the input unchanged when it is not a parseable URL", () => {
    const dsn = "host=localhost port=5432 dbname=xpertmoto user=postgres";
    expect(pgConnectionString(dsn)).toBe(dsn);
  });
});
