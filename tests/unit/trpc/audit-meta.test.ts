import { describe, expect, test } from "vitest";
import { getByPath, resolveBookingId, resolveCustomerId } from "@/server/trpc/trpc";
import type { Context } from "@/server/trpc/context";

const stubCtx = { session: { user: { id: "session-user-1" } } } as unknown as Context;

describe("getByPath", () => {
  test("returns the value at a dotted path", () => {
    expect(getByPath({ a: { b: { c: "x" } } }, "a.b.c")).toBe("x");
  });

  test("returns undefined when any segment is missing", () => {
    expect(getByPath({ a: {} }, "a.b.c")).toBeUndefined();
  });

  test("returns undefined for non-object input", () => {
    expect(getByPath(null, "a")).toBeUndefined();
    expect(getByPath("str", "a")).toBeUndefined();
  });
});

describe("resolveCustomerId", () => {
  test("returns undefined when meta is true or absent", () => {
    expect(resolveCustomerId(true, {}, stubCtx)).toBeUndefined();
    expect(resolveCustomerId(undefined, {}, stubCtx)).toBeUndefined();
  });

  test("returns undefined when customerIdPath is absent", () => {
    expect(resolveCustomerId({}, {}, stubCtx)).toBeUndefined();
  });

  test("string path resolves against input", () => {
    const id = resolveCustomerId(
      { customerIdPath: "customerId" },
      { customerId: "cust-1" },
      stubCtx,
    );
    expect(id).toBe("cust-1");
  });

  test("function path receives input and ctx", () => {
    const id = resolveCustomerId(
      { customerIdPath: (_i, c) => (c as { session?: { user?: { id?: string } } }).session?.user?.id },
      {},
      stubCtx,
    );
    expect(id).toBe("session-user-1");
  });

  test("returns undefined when resolver yields non-string", () => {
    const id = resolveCustomerId(
      { customerIdPath: "customerId" },
      { customerId: null },
      stubCtx,
    );
    expect(id).toBeUndefined();
  });

  test("returns undefined when resolved string is empty", () => {
    const id = resolveCustomerId(
      { customerIdPath: "customerId" },
      { customerId: "" },
      stubCtx,
    );
    expect(id).toBeUndefined();
  });
});

describe("resolveBookingId", () => {
  test("returns undefined when meta is true or absent", () => {
    expect(resolveBookingId(true, {}, stubCtx)).toBeUndefined();
    expect(resolveBookingId(undefined, {}, stubCtx)).toBeUndefined();
  });

  test("returns undefined when bookingIdPath is absent", () => {
    expect(resolveBookingId({}, {}, stubCtx)).toBeUndefined();
    expect(resolveBookingId({ customerIdPath: "customerId" }, {}, stubCtx)).toBeUndefined();
  });

  test("string path resolves against input", () => {
    const id = resolveBookingId(
      { bookingIdPath: "bookingId" },
      { bookingId: "bk-1" },
      stubCtx,
    );
    expect(id).toBe("bk-1");
  });

  test("function path receives input and ctx", () => {
    const id = resolveBookingId(
      {
        bookingIdPath: (_i, c) =>
          (c as { capturedBookingId?: string }).capturedBookingId,
      },
      {},
      { capturedBookingId: "bk-captured" } as unknown as Context,
    );
    expect(id).toBe("bk-captured");
  });

  test("returns undefined when resolver yields non-string or empty", () => {
    expect(
      resolveBookingId({ bookingIdPath: "bookingId" }, { bookingId: null }, stubCtx),
    ).toBeUndefined();
    expect(
      resolveBookingId({ bookingIdPath: "bookingId" }, { bookingId: "" }, stubCtx),
    ).toBeUndefined();
  });
});
