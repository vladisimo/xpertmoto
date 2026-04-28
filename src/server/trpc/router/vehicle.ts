import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { FleetUseCase } from "@prisma/client";
import { createTRPCRouter, publicProcedure, staffProcedure } from "../trpc";

const fleetUseCaseSchema = z.nativeEnum(FleetUseCase);

export const vehicleRouter = createTRPCRouter({
  listCategories: publicProcedure.query(({ ctx }) =>
    ctx.prisma.vehicleCategory.findMany({
      where: { isActive: true },
      orderBy: { displayOrder: "asc" },
    }),
  ),
  listModels: publicProcedure
    .input(z.object({ useCase: fleetUseCaseSchema.optional() }))
    .query(async ({ ctx, input }) => {
      const models = await ctx.prisma.vehicleModel.findMany({
        where: {
          vehicles: { some: { isActive: true } },
          ...(input.useCase ? { useCases: { has: input.useCase } } : {}),
        },
        select: {
          id: true,
          slug: true,
          make: true,
          model: true,
          year: true,
          tagline: true,
          useCases: true,
          heroImageKey: true,
          engineCapacityCc: true,
          enginePowerKw: true,
          seatHeightMm: true,
          fuelType: true,
          category: {
            select: {
              id: true,
              slug: true,
              name: true,
              licenceRequired: true,
              minAge: true,
              baseDailyRate: true,
              baseWeeklyRate: true,
              bondAmount: true,
            },
          },
          vehicles: {
            where: { isActive: true },
            select: {
              id: true,
              status: true,
              images: {
                where: { isPrimary: true },
                orderBy: { displayOrder: "asc" },
                take: 1,
                select: { url: true },
              },
            },
          },
        },
        orderBy: [{ make: "asc" }, { model: "asc" }],
      });

      return models
        .map((m) => {
          const availableCount = m.vehicles.filter((v) => v.status === "AVAILABLE").length;
          const primaryImageUrl =
            m.vehicles
              .flatMap((v) => v.images)
              .find((img) => Boolean(img?.url))?.url ?? null;
          const { vehicles: _vehicles, ...rest } = m;
          return {
            ...rest,
            availableCount,
            inventoryCount: m.vehicles.length,
            primaryImageUrl,
          };
        })
        .sort((a, b) => {
          if (b.availableCount !== a.availableCount) return b.availableCount - a.availableCount;
          if (a.make !== b.make) return a.make.localeCompare(b.make);
          return a.model.localeCompare(b.model);
        });
    }),
  modelBySlug: publicProcedure
    .input(z.object({ slug: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const model = await ctx.prisma.vehicleModel.findUnique({
        where: { slug: input.slug },
        include: {
          category: true,
          documents: {
            orderBy: { createdAt: "desc" },
          },
          vehicles: {
            where: { isActive: true },
            orderBy: [{ status: "asc" }, { currentOdometerKm: "asc" }],
            select: {
              id: true,
              status: true,
              currentOdometerKm: true,
              depot: { select: { id: true, name: true, slug: true, state: true } },
              images: {
                orderBy: [{ isPrimary: "desc" }, { displayOrder: "asc" }],
                select: { id: true, url: true, caption: true, isPrimary: true },
              },
            },
          },
        },
      });

      if (!model || !model.vehicles.length) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Model not found" });
      }

      const imageSeen = new Set<string>();
      const images: Array<{ id: string; url: string; caption: string | null }> = [];
      for (const v of model.vehicles) {
        for (const img of v.images) {
          if (imageSeen.has(img.url)) continue;
          imageSeen.add(img.url);
          images.push({ id: img.id, url: img.url, caption: img.caption ?? null });
        }
      }

      const available = model.vehicles.filter((v) => v.status === "AVAILABLE");
      const depotMap = new Map<
        string,
        { id: string; name: string; slug: string; state: string; availableCount: number }
      >();
      for (const v of available) {
        if (!v.depot) continue;
        const existing = depotMap.get(v.depot.id);
        if (existing) existing.availableCount += 1;
        else depotMap.set(v.depot.id, { ...v.depot, availableCount: 1 });
      }

      const { vehicles: _vehicles, ...rest } = model;
      return {
        ...rest,
        images,
        availableCount: available.length,
        inventoryCount: model.vehicles.length,
        firstAvailableVehicleId: available[0]?.id ?? null,
        depotsWithStock: Array.from(depotMap.values()).sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      };
    }),
  byId: publicProcedure.input(z.object({ id: z.string() })).query(({ ctx, input }) =>
    ctx.prisma.vehicle.findUnique({
      where: { id: input.id },
      include: {
        category: true,
        depot: true,
        images: { orderBy: [{ isPrimary: "desc" }, { displayOrder: "asc" }] },
        catalogueModel: { include: { documents: true } },
      },
    }),
  ),
  listAvailable: publicProcedure
    .input(
      z.object({
        depotId: z.string().optional(),
        categoryId: z.string().optional(),
      }),
    )
    .query(({ ctx, input }) =>
      ctx.prisma.vehicle.findMany({
        where: {
          status: "AVAILABLE",
          isActive: true,
          ...(input.depotId ? { depotId: input.depotId } : {}),
          ...(input.categoryId ? { categoryId: input.categoryId } : {}),
        },
        include: { category: true, depot: true, images: true },
      }),
    ),
  list: staffProcedure
    .input(
      z.object({
        depotId: z.string().optional(),
        status: z.string().optional(),
        take: z.number().min(1).max(200).default(50),
        cursor: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const items = await ctx.prisma.vehicle.findMany({
        where: {
          ...(input.depotId ? { depotId: input.depotId } : {}),
          ...(input.status ? { status: input.status as never } : {}),
        },
        include: { category: true, depot: true },
        take: input.take + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        orderBy: { internalCode: "asc" },
      });
      const nextCursor = items.length > input.take ? items.pop()!.id : null;
      return { items, nextCursor };
    }),
});
