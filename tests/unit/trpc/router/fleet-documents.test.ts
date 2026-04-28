import { beforeEach, describe, expect, it, vi } from "vitest";
import { fleetRouter } from "../../../../src/server/trpc/router/fleet";

type Caller = ReturnType<typeof fleetRouter.createCaller>;

const BASE_VEHICLE = {
  id: "veh1",
  depotId: "dep1",
  ctpExpiry: null as Date | null,
  regoExpiry: null as Date | null,
  insuranceExpiry: null as Date | null,
  warrantyExpiry: null as Date | null,
  lastServiceDate: null as Date | null,
  lastServiceKm: null as number | null,
};

interface MockState {
  vehicle: typeof BASE_VEHICLE;
  documents: Array<Record<string, unknown>>;
  workOrders: Array<Record<string, unknown>>;
  infringements: Array<Record<string, unknown>>;
  auditLogs: Array<Record<string, unknown>>;
}

function makeCtx(over: { vehicle?: Partial<typeof BASE_VEHICLE>; role?: "STAFF" | "MANAGER" | "ADMIN" | "SUPER_ADMIN" } = {}) {
  const state: MockState = {
    vehicle: { ...BASE_VEHICLE, ...over.vehicle },
    documents: [],
    workOrders: [],
    infringements: [],
    auditLogs: [],
  };

  const tx = {
    vehicle: {
      update: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        Object.assign(state.vehicle, data);
        return Promise.resolve({ ...state.vehicle });
      }),
    },
    maintenanceWorkOrder: {
      create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `wo-${state.workOrders.length + 1}`, ...data };
        state.workOrders.push(row);
        return Promise.resolve(row);
      }),
    },
    infringement: {
      create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `inf-${state.infringements.length + 1}`, ...data };
        state.infringements.push(row);
        return Promise.resolve(row);
      }),
    },
    vehicleDocument: {
      create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `doc-${state.documents.length + 1}`, createdAt: new Date(), ...data };
        state.documents.push(row);
        return Promise.resolve(row);
      }),
      update: vi.fn().mockImplementation(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const doc = state.documents.find((d) => d.id === where.id);
        if (doc) Object.assign(doc, data);
        return Promise.resolve(doc);
      }),
    },
    auditLog: {
      create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `audit-${state.auditLogs.length + 1}`, timestamp: new Date(), ...data };
        state.auditLogs.push(row);
        return Promise.resolve(row);
      }),
    },
  };

  const prisma = {
    vehicle: {
      findUnique: vi.fn().mockImplementation(() => Promise.resolve({ ...state.vehicle })),
    },
    vehicleDocument: {
      findUnique: vi.fn().mockImplementation(({ where }: { where: { id: string } }) => {
        const doc = state.documents.find((d) => d.id === where.id);
        return Promise.resolve(doc ?? null);
      }),
      update: vi.fn().mockImplementation(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const doc = state.documents.find((d) => d.id === where.id);
        if (doc) Object.assign(doc, data);
        return Promise.resolve(doc);
      }),
    },
    $transaction: vi.fn().mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };

  const role = over.role ?? "STAFF";

  return {
    ctx: {
      prisma,
      user: { id: "staff1", role },
      session: { user: { id: "staff1", role } },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      reqId: "r1",
    } as unknown as Parameters<Caller["addVehicleDocument"]>[0],
    state,
    tx,
  };
}

function caller(ctx: unknown): Caller {
  return fleetRouter.createCaller(ctx as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fleet.addVehicleDocument — compliance (expiry) docs", () => {
  it("CTP upload with a later expiry bumps Vehicle.ctpExpiry", async () => {
    const { ctx, state, tx } = makeCtx({ vehicle: { ctpExpiry: new Date("2026-01-01") } });
    const c = caller(ctx);

    await c.addVehicleDocument({
      vehicleId: "veh1",
      type: "CTP",
      fileUrl: "https://storage/ctp.pdf",
      expiryDate: new Date("2027-06-30"),
    });

    expect(tx.vehicle.update).toHaveBeenCalledWith({
      where: { id: "veh1" },
      data: { ctpExpiry: new Date("2027-06-30") },
    });
    expect(state.vehicle.ctpExpiry).toEqual(new Date("2027-06-30"));
    expect(state.documents[0]).toMatchObject({
      type: "CTP",
      fileUrl: "https://storage/ctp.pdf",
      expiryDate: new Date("2027-06-30"),
      uploadedById: "staff1",
    });
  });

  it("CTP upload with an earlier expiry does NOT regress Vehicle.ctpExpiry", async () => {
    const { ctx, state, tx } = makeCtx({ vehicle: { ctpExpiry: new Date("2027-06-30") } });
    const c = caller(ctx);

    await c.addVehicleDocument({
      vehicleId: "veh1",
      type: "CTP",
      fileUrl: "https://storage/old-ctp.pdf",
      expiryDate: new Date("2020-01-01"),
    });

    expect(tx.vehicle.update).not.toHaveBeenCalled();
    expect(state.vehicle.ctpExpiry).toEqual(new Date("2027-06-30"));
    // The document itself is still saved with its (older) expiry.
    expect(state.documents[0]?.expiryDate).toEqual(new Date("2020-01-01"));
  });

  it("REGO_CERT updates regoExpiry; INSURANCE updates insuranceExpiry; WARRANTY updates warrantyExpiry", async () => {
    const { ctx, state } = makeCtx();
    const c = caller(ctx);

    await c.addVehicleDocument({
      vehicleId: "veh1",
      type: "REGO_CERT",
      fileUrl: "https://storage/rego.pdf",
      expiryDate: new Date("2027-02-01"),
    });
    await c.addVehicleDocument({
      vehicleId: "veh1",
      type: "INSURANCE",
      fileUrl: "https://storage/ins.pdf",
      expiryDate: new Date("2027-03-01"),
    });
    await c.addVehicleDocument({
      vehicleId: "veh1",
      type: "WARRANTY",
      fileUrl: "https://storage/warr.pdf",
      expiryDate: new Date("2027-04-01"),
    });

    expect(state.vehicle.regoExpiry).toEqual(new Date("2027-02-01"));
    expect(state.vehicle.insuranceExpiry).toEqual(new Date("2027-03-01"));
    expect(state.vehicle.warrantyExpiry).toEqual(new Date("2027-04-01"));
  });
});

describe("fleet.addVehicleDocument — infringement", () => {
  it("creates an Infringement record, links the document, and mirrors amount", async () => {
    const { ctx, state, tx } = makeCtx();
    const c = caller(ctx);

    await c.addVehicleDocument({
      vehicleId: "veh1",
      type: "INFRINGEMENT",
      fileUrl: "https://storage/inf.pdf",
      infringementType: "SPEEDING",
      issuer: "Transport for NSW",
      referenceNumber: "INF-555",
      offenceDate: new Date("2026-03-10"),
      amount: 340,
    });

    expect(tx.infringement.create).toHaveBeenCalledTimes(1);
    const infCall = tx.infringement.create.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(infCall.data).toMatchObject({
      vehicleId: "veh1",
      type: "SPEEDING",
      issuer: "Transport for NSW",
      referenceNumber: "INF-555",
      amount: 340,
      documentUrl: "https://storage/inf.pdf",
      status: "RECEIVED",
    });

    expect(state.documents[0]).toMatchObject({
      type: "INFRINGEMENT",
      cost: 340,
      referenceNumber: "INF-555",
      relatedInfringementId: state.infringements[0]!.id,
      issueDate: new Date("2026-03-10"),
    });
  });
});

describe("fleet.addVehicleDocument — cost-bearing (work-order) docs", () => {
  it("REPAIR_BILL creates a COMPLETED WO (type CUSTOM) with the cost on actualCost and links the doc", async () => {
    const { ctx, state, tx } = makeCtx();
    const c = caller(ctx);

    await c.addVehicleDocument({
      vehicleId: "veh1",
      type: "REPAIR_BILL",
      fileUrl: "https://storage/repair.jpg",
      cost: 450,
      supplier: "Fast Fix Scooters",
      description: "Rear brake caliper rebuild",
    });

    expect(tx.maintenanceWorkOrder.create).toHaveBeenCalledTimes(1);
    const woCall = tx.maintenanceWorkOrder.create.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(woCall.data).toMatchObject({
      vehicleId: "veh1",
      depotId: "dep1",
      type: "CUSTOM",
      status: "COMPLETED",
      priority: "MEDIUM",
      title: "Repair bill",
      attachments: ["https://storage/repair.jpg"],
      actualCost: 450,
      externalSupplier: "Fast Fix Scooters",
      description: "Rear brake caliper rebuild",
    });
    expect(woCall.data.workOrderNumber).toMatch(/^WO-/);

    expect(state.documents[0]).toMatchObject({
      type: "REPAIR_BILL",
      cost: 450,
      relatedWorkOrderId: state.workOrders[0]!.id,
    });
  });

  it("PARTS_PURCHASE puts the cost on both partsCost and actualCost", async () => {
    const { ctx, tx } = makeCtx();
    const c = caller(ctx);

    await c.addVehicleDocument({
      vehicleId: "veh1",
      type: "PARTS_PURCHASE",
      fileUrl: "https://storage/parts.pdf",
      cost: 120,
    });

    const woCall = tx.maintenanceWorkOrder.create.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(woCall.data).toMatchObject({ partsCost: 120, actualCost: 120, type: "CUSTOM" });
  });

  it("SERVICE_FEE with odometerAtService updates Vehicle.lastServiceDate and lastServiceKm", async () => {
    const { ctx, state } = makeCtx();
    const c = caller(ctx);

    const before = Date.now();
    await c.addVehicleDocument({
      vehicleId: "veh1",
      type: "SERVICE_FEE",
      fileUrl: "https://storage/service.pdf",
      cost: 220,
      odometerAtService: 8540,
    });

    expect(state.vehicle.lastServiceKm).toBe(8540);
    expect(state.vehicle.lastServiceDate).toBeInstanceOf(Date);
    expect((state.vehicle.lastServiceDate as Date).getTime()).toBeGreaterThanOrEqual(before);
  });

  it("TYRE_REPLACEMENT creates a WO of type TYRE_REPLACEMENT", async () => {
    const { ctx, tx } = makeCtx();
    const c = caller(ctx);

    await c.addVehicleDocument({
      vehicleId: "veh1",
      type: "TYRE_REPLACEMENT",
      fileUrl: "https://storage/tyres.pdf",
      cost: 380,
    });

    const woCall = tx.maintenanceWorkOrder.create.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(woCall.data.type).toBe("TYRE_REPLACEMENT");
    expect(woCall.data.title).toBe("Tyre replacement");
  });
});

describe("fleet.addVehicleDocument — thumbnailUrl passthrough", () => {
  it("persists thumbnailUrl from the upload endpoint into the VehicleDocument row", async () => {
    const { ctx, state } = makeCtx();
    const c = caller(ctx);

    await c.addVehicleDocument({
      vehicleId: "veh1",
      type: "CTP",
      fileUrl: "https://storage/ctp.pdf",
      thumbnailUrl: "https://storage/ctp-thumb.png",
      expiryDate: new Date("2027-06-30"),
    });

    expect(state.documents[0]).toMatchObject({
      thumbnailUrl: "https://storage/ctp-thumb.png",
    });
  });

  it("defaults thumbnailUrl to null when not provided (e.g. PDF render failed)", async () => {
    const { ctx, state } = makeCtx();
    const c = caller(ctx);

    await c.addVehicleDocument({
      vehicleId: "veh1",
      type: "CTP",
      fileUrl: "https://storage/ctp.pdf",
      expiryDate: new Date("2027-06-30"),
    });

    expect(state.documents[0]!.thumbnailUrl).toBeNull();
  });
});

describe("fleet.addVehicleDocument — other types", () => {
  it("PURCHASE_RECEIPT stores optional cost and does not touch WO / infringement", async () => {
    const { ctx, state, tx } = makeCtx();
    const c = caller(ctx);

    await c.addVehicleDocument({
      vehicleId: "veh1",
      type: "PURCHASE_RECEIPT",
      fileUrl: "https://storage/receipt.pdf",
      cost: 4500,
    });

    expect(tx.maintenanceWorkOrder.create).not.toHaveBeenCalled();
    expect(tx.infringement.create).not.toHaveBeenCalled();
    expect(state.documents[0]).toMatchObject({ type: "PURCHASE_RECEIPT", cost: 4500 });
  });

  it("OTHER is a pure attachment with no side effects", async () => {
    const { ctx, state, tx } = makeCtx();
    const c = caller(ctx);

    await c.addVehicleDocument({
      vehicleId: "veh1",
      type: "OTHER",
      fileUrl: "https://storage/misc.pdf",
      notes: "Photo of engine bay",
    });

    expect(tx.vehicle.update).not.toHaveBeenCalled();
    expect(tx.maintenanceWorkOrder.create).not.toHaveBeenCalled();
    expect(tx.infringement.create).not.toHaveBeenCalled();
    expect(state.documents[0]).toMatchObject({ type: "OTHER", notes: "Photo of engine bay" });
  });
});

describe("fleet.addVehicleDocument — audit trail", () => {
  it("writes a VEHICLE_DOCUMENT_UPLOADED AuditLog entry scoped to the vehicle", async () => {
    const { ctx, state } = makeCtx();
    const c = caller(ctx);

    await c.addVehicleDocument({
      vehicleId: "veh1",
      type: "CTP",
      fileUrl: "https://storage/ctp.pdf",
      expiryDate: new Date("2027-06-30"),
    });

    expect(state.auditLogs).toHaveLength(1);
    expect(state.auditLogs[0]).toMatchObject({
      userId: "staff1",
      action: "VEHICLE_DOCUMENT_UPLOADED",
      entity: "Vehicle",
      entityId: "veh1",
      category: "MUTATION",
      status: "SUCCESS",
      depotId: "dep1",
    });
    const newData = state.auditLogs[0]!.newData as Record<string, unknown>;
    expect(newData.type).toBe("CTP");
    expect(newData.fileUrl).toBe("https://storage/ctp.pdf");
    expect(newData.documentId).toBe(state.documents[0]!.id);
  });
});

describe("fleet.deleteVehicleDocument — audit trail", () => {
  it("writes a VEHICLE_DOCUMENT_DELETED AuditLog entry and soft-deletes the row", async () => {
    const { ctx, state } = makeCtx();
    const c = caller(ctx);

    await c.addVehicleDocument({
      vehicleId: "veh1",
      type: "OTHER",
      fileUrl: "https://storage/misc.pdf",
    });
    const docId = state.documents[0]!.id as string;

    await c.deleteVehicleDocument({ id: docId });

    const deleteAudit = state.auditLogs.find((a) => a.action === "VEHICLE_DOCUMENT_DELETED");
    expect(deleteAudit).toBeDefined();
    expect(deleteAudit).toMatchObject({
      userId: "staff1",
      entity: "Vehicle",
      entityId: "veh1",
      category: "MUTATION",
      status: "SUCCESS",
    });
    const previousData = deleteAudit!.previousData as Record<string, unknown>;
    expect(previousData.documentId).toBe(docId);
    expect(previousData.fileUrl).toBe("https://storage/misc.pdf");
    expect(state.documents[0]!.deletedAt).toBeInstanceOf(Date);
  });
});

describe("fleet.deleteVehicleDocument", () => {
  it("soft-deletes the document without touching the linked WO / infringement", async () => {
    const { ctx, state, tx } = makeCtx();
    const c = caller(ctx);

    // Seed a REPAIR_BILL upload first so we have a real doc + WO to delete.
    await c.addVehicleDocument({
      vehicleId: "veh1",
      type: "REPAIR_BILL",
      fileUrl: "https://storage/repair.pdf",
      cost: 200,
    });
    const docId = state.documents[0]!.id as string;
    const woId = state.workOrders[0]!.id as string;

    await c.deleteVehicleDocument({ id: docId });

    expect(state.documents[0]!.deletedAt).toBeInstanceOf(Date);
    // WO was never touched by the delete.
    expect(tx.maintenanceWorkOrder.create).toHaveBeenCalledTimes(1);
    expect(state.workOrders.find((w) => w.id === woId)).toBeDefined();
  });

  it("rejects when the document is missing or already soft-deleted", async () => {
    const { ctx } = makeCtx();
    const c = caller(ctx);

    await expect(c.deleteVehicleDocument({ id: "nope" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
