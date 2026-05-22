import { PrismaClient, Prisma, UserRole, VehicleStatus, BookingStatus, AddonType, InspectionType, InspectionStatus, VehicleCondition, type NotificationType, type NotificationCategory, type NotificationChannel } from "@prisma/client";
import bcrypt from "bcryptjs";
import { paragraphs, renderEmailShell, summaryTable } from "../src/lib/email-shell";

const prisma = new PrismaClient();

function rand<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function bookingRef(i: number) {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `SCT-${ymd}-${String(1000 + i).padStart(4, "0")}`;
}

async function main() {
  console.log("🌱 Seeding XPERT Moto...");

  // Wipe (dev only)
  await prisma.$transaction([
    prisma.oneWayFee.deleteMany(),
    prisma.bookingAddon.deleteMany(),
    prisma.bookingInsurance.deleteMany(),
    prisma.bookingNote.deleteMany(),
    prisma.bookingStatusLog.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.invoice.deleteMany(),
    prisma.bondLedger.deleteMany(),
    prisma.booking.deleteMany(),
    prisma.inspectionPhoto.deleteMany(),
    prisma.inspectionItem.deleteMany(),
    prisma.inspection.deleteMany(),
    prisma.maintenancePart.deleteMany(),
    prisma.maintenanceLog.deleteMany(),
    prisma.maintenanceWorkOrder.deleteMany(),
    prisma.maintenanceSchedule.deleteMany(),
    prisma.incidentPhoto.deleteMany(),
    prisma.incidentDocument.deleteMany(),
    prisma.incidentNote.deleteMany(),
    prisma.incident.deleteMany(),
    prisma.infringement.deleteMany(),
    prisma.vehicleImage.deleteMany(),
    prisma.vehicleDocument.deleteMany(),
    prisma.vehicleStatusLog.deleteMany(),
    prisma.vehicleTransfer.deleteMany(),
    prisma.vehicle.deleteMany(),
    prisma.pricingRule.deleteMany(),
    prisma.season.deleteMany(),
    prisma.package.deleteMany(),
    prisma.addon.deleteMany(),
    prisma.discount.deleteMany(),
    prisma.insuranceOption.deleteMany(),
    prisma.vehicleCategory.deleteMany(),
    prisma.depotOperatingHours.deleteMany(),
    prisma.customerProfile.deleteMany(),
    prisma.staffProfile.deleteMany(),
    prisma.account.deleteMany(),
    prisma.session.deleteMany(),
    prisma.user.deleteMany(),
    prisma.depot.deleteMany(),
    prisma.organisation.deleteMany(),
  ]);

  // Organisation
  await prisma.organisation.create({
    data: {
      name: "XPERT Moto Group Pty Ltd",
      abn: "72 629 456 408",
      settings: { currency: "AUD", gstRate: 0.1, acn: "629 456 408" },
    },
  });

  // Depots
  const lewisham = await prisma.depot.create({
    data: {
      name: "XPERT Moto Lewisham",
      slug: "lewisham",
      addressLine1: "798 Parramatta Road",
      suburb: "Lewisham",
      state: "NSW",
      postcode: "2049",
      phone: "+61 433 880 748",
      email: "book@xpertmoto.com.au",
      timezone: "Australia/Sydney",
    },
  });
  const depots = [lewisham];
  // QA fixtures below pre-date the single-depot consolidation; aliases keep
  // them compiling and collapse them onto Lewisham. Blocks that require
  // distinct depots (e.g. one-way fees) are guarded separately.
  const gc = lewisham;
  const bb = lewisham;
  const ns = lewisham;

  // Operating hours (all depots, Mon-Sun 8-18)
  for (const d of depots) {
    for (let dow = 0; dow < 7; dow++) {
      await prisma.depotOperatingHours.create({
        data: { depotId: d.id, dayOfWeek: dow, openTime: "08:00", closeTime: "18:00" },
      });
    }
  }

  // Categories — licence-based, matching the real fleet shape.
  const catDefs = [
    {
      name: "LAMS Motorcycle",
      slug: "lams-motorcycle",
      cc: 660,
      lic: "R",
      daily: 69,
      weekly: 399,
      monthly: 1149,
      bond: 500,
      minAge: 18,
      description: "LAMS-approved motorcycles and scooters — suitable for learner and provisional riders on an R class licence.",
    },
    {
      name: "Unrestricted Motorcycle",
      slug: "unrestricted-motorcycle",
      cc: 1300,
      lic: "R",
      daily: 129,
      weekly: 699,
      monthly: 1999,
      bond: 1500,
      minAge: 24,
      description: "Full-power motorcycles above LAMS — requires an unrestricted (R) licence.",
    },
    {
      name: "Utility Vehicle",
      slug: "utility-vehicle",
      cc: 1500,
      lic: "Car",
      daily: 99,
      weekly: 499,
      monthly: 1499,
      bond: 800,
      minAge: 21,
      description: "Light commercial vehicles for pickups, cargo, and deliveries.",
    },
  ];
  const categories = [];
  for (const [i, c] of catDefs.entries()) {
    categories.push(
      await prisma.vehicleCategory.create({
        data: {
          name: c.name,
          slug: c.slug,
          engineCapacity: c.cc,
          licenceRequired: c.lic,
          minAge: c.minAge,
          displayOrder: i,
          baseDailyRate: c.daily,
          baseWeeklyRate: c.weekly,
          baseMonthlyRate: c.monthly,
          bondAmount: c.bond,
          description: c.description,
        },
      }),
    );
  }

  // Seasons
  await prisma.season.createMany({
    data: [
      { name: "Christmas Peak", startDate: new Date("2026-12-20"), endDate: new Date("2027-01-10"), multiplier: 1.5 },
      { name: "Easter Peak", startDate: new Date("2026-04-03"), endDate: new Date("2026-04-13"), multiplier: 1.3 },
      { name: "School Holidays", startDate: new Date("2026-06-28"), endDate: new Date("2026-07-13"), multiplier: 1.2 },
      { name: "Winter Low", startDate: new Date("2026-06-01"), endDate: new Date("2026-07-31"), multiplier: 0.85 },
    ],
  });

  // Addons
  const addonDefs: { name: string; type: AddonType; daily?: number; flat?: number; perDay?: boolean; required?: boolean }[] = [
    { name: "Helmet", type: "HELMET", daily: 5, perDay: true, required: true },
    { name: "Phone mount", type: "PHONE_MOUNT", daily: 3, perDay: true },
    { name: "Lock & chain", type: "LOCK", daily: 3, perDay: true },
    { name: "Pannier/top box", type: "PANNIERS", daily: 8, perDay: true },
    { name: "GPS unit", type: "GPS", daily: 5, perDay: true },
    { name: "Rain poncho", type: "RAIN_GEAR", daily: 2, perDay: true },
    { name: "Roadside assist", type: "ROADSIDE_ASSIST", daily: 7, perDay: true },
    { name: "Delivery (0-10km)", type: "DELIVERY", flat: 25, perDay: false },
    { name: "Delivery (10-25km)", type: "DELIVERY", flat: 45, perDay: false },
    { name: "Pickup", type: "PICKUP", flat: 25, perDay: false },
  ];
  for (const a of addonDefs) {
    await prisma.addon.create({
      data: {
        name: a.name,
        type: a.type,
        dailyRate: a.daily ?? null,
        flatRate: a.flat ?? null,
        isPerDay: a.perDay ?? true,
        isRequired: a.required ?? false,
      },
    });
  }

  // Insurance options
  await prisma.insuranceOption.createMany({
    data: [
      { name: "Basic", description: "Included — $3,000 excess", dailyRate: 0, excessAmount: 3000, isDefault: true },
      { name: "Standard", description: "Reduced excess", dailyRate: 12, excessAmount: 1500 },
      { name: "Premium", description: "Zero excess", dailyRate: 22, excessAmount: 0 },
    ],
  });

  // Users
  const adminPw = await bcrypt.hash("admin1234", 10);
  const staffPw = await bcrypt.hash("staff1234", 10);
  const custPw = await bcrypt.hash("customer1234", 10);

  const admin = await prisma.user.create({
    data: {
      email: "admin@xpertmoto.com.au",
      firstName: "Admin",
      lastName: "User",
      passwordHash: adminPw,
      role: "SUPER_ADMIN" satisfies UserRole,
      emailVerified: new Date(),
    },
  });

  for (const [i, d] of depots.entries()) {
    const mgr = await prisma.user.create({
      data: {
        email: `manager.${d.slug}@xpertmoto.com.au`,
        firstName: "Manager",
        lastName: d.name.split(" ").pop() ?? "",
        passwordHash: staffPw,
        role: "MANAGER",
        depotId: d.id,
        emailVerified: new Date(),
      },
    });
    await prisma.staffProfile.create({
      data: { userId: mgr.id, employeeId: `MGR-${String(i + 1).padStart(3, "0")}`, position: "Depot Manager", canPerformMaintenance: true },
    });
    const staff = await prisma.user.create({
      data: {
        email: `staff.${d.slug}@xpertmoto.com.au`,
        firstName: "Staff",
        lastName: d.name.split(" ").pop() ?? "",
        passwordHash: staffPw,
        role: "STAFF",
        depotId: d.id,
        emailVerified: new Date(),
      },
    });
    await prisma.staffProfile.create({
      data: { userId: staff.id, employeeId: `STF-${String(i + 1).padStart(3, "0")}`, position: "Front Desk" },
    });
  }

  // Customers
  const firstNames = ["Sarah", "James", "Emily", "Liam", "Olivia", "Noah", "Ava", "Mason", "Isla", "Lucas", "Mia", "Ethan", "Zoe", "Oliver", "Charlotte", "Harry", "Amelia", "Jack", "Ruby", "Henry"];
  const lastNames = ["Smith", "Jones", "Williams", "Brown", "Wilson", "Taylor", "Johnson", "White", "Martin", "Anderson", "Thompson", "Nguyen", "Harris", "Ryan", "King", "Wright", "Lee", "Walker", "Hall", "Young"];
  const customers = [];
  const now = new Date();
  const daysFromNow = (days: number): Date => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    return d;
  };
  for (let i = 0; i < 20; i++) {
    const fn = firstNames[i]!;
    const ln = lastNames[i]!;
    const u = await prisma.user.create({
      data: {
        email: `${fn.toLowerCase()}.${ln.toLowerCase()}@example.com`,
        firstName: fn,
        lastName: ln,
        passwordHash: custPw,
        role: "CUSTOMER",
        phone: `04${String(Math.floor(10000000 + Math.random() * 89999999))}`,
        dateOfBirth: new Date(1985 + (i % 20), i % 12, (i % 27) + 1),
        emailVerified: new Date(),
      },
    });

    // ~50% of customers also get a passport on file. Of those, distribute
    // expiries across valid / expiring-soon / expired windows so the job +
    // verification queue has something to pick up.
    const hasPassport = i % 2 === 0;
    let passportExpiry: Date | null = null;
    let passportCountry: string | null = null;
    let passportNumber: string | null = null;
    if (hasPassport) {
      const bucket = i % 6; // 0,1,2 → valid; 3,4 → soon; 5 → expired
      passportCountry = rand(["AU", "NZ", "GB", "US", "DE"]);
      passportNumber = `${passportCountry === "AU" ? "PA" : passportCountry}${String(1000000 + i * 7919)}`;
      if (bucket >= 5) passportExpiry = daysFromNow(-30 - (i % 150));
      else if (bucket >= 3) passportExpiry = daysFromNow(15 + (i % 45));
      else passportExpiry = daysFromNow(365 * (2 + (i % 4)));
    }

    await prisma.customerProfile.create({
      data: {
        userId: u.id,
        licenceNumber: String(10000000 + i * 12345),
        licenceState: rand(["QLD", "NSW", "VIC"]),
        licenceClass: rand(["C", "RE", "R"]),
        licenceExpiry: new Date(2028, i % 12, (i % 27) + 1),
        licenceVerifiedAt: i % 3 === 0 ? null : new Date(),
        passportNumber,
        passportCountry,
        passportExpiry,
        passportVerifiedAt: hasPassport && i % 4 === 0 ? new Date() : null,
        addressLine1: `${i + 1} Beach Rd`,
        suburb: rand(["Surfers Paradise", "Byron Bay", "Noosa Heads"]),
        state: rand(["QLD", "NSW", "QLD"]),
        postcode: rand(["4217", "2481", "4567"]),
      },
    });
    customers.push(u);
  }

  // Passport-only test customers: no licence on file, just a valid
  // passport. Playwright + manual smoke tests use these to exercise the
  // eligibility basis: "passport" path, including the motorcycle warning.
  for (let i = 1; i <= 3; i++) {
    const u = await prisma.user.create({
      data: {
        email: `pat.passport+${i}@example.test`,
        firstName: "Pat",
        lastName: `Passport-${i}`,
        passwordHash: custPw,
        role: "CUSTOMER",
        phone: `04${String(Math.floor(20000000 + Math.random() * 69999999))}`,
        dateOfBirth: new Date(1990, i, i + 10),
        emailVerified: new Date(),
      },
    });
    await prisma.customerProfile.create({
      data: {
        userId: u.id,
        // No licenceNumber / licenceClass / licenceExpiry — passport-only.
        passportNumber: `PA${String(9000000 + i * 111)}`,
        passportCountry: rand(["AU", "NZ", "GB"]),
        passportExpiry: daysFromNow(365 * (3 + i)),
        passportVerifiedAt: i === 1 ? new Date() : null,
        addressLine1: `${i * 11} Bay St`,
        suburb: "Byron Bay",
        state: "NSW",
        postcode: "2481",
      },
    });
    customers.push(u);
  }

  // Both-valid test customers: licence AND passport, both in-date.
  // Exercises the eligibility `basis: "both"` branch.
  for (let i = 1; i <= 2; i++) {
    const u = await prisma.user.create({
      data: {
        email: `both.valid+${i}@example.test`,
        firstName: "Both",
        lastName: `Valid-${i}`,
        passwordHash: custPw,
        role: "CUSTOMER",
        phone: `04${String(Math.floor(30000000 + Math.random() * 59999999))}`,
        dateOfBirth: new Date(1988, i * 3, i + 5),
        emailVerified: new Date(),
      },
    });
    await prisma.customerProfile.create({
      data: {
        userId: u.id,
        licenceNumber: String(80000000 + i * 999),
        licenceState: "QLD",
        licenceClass: "R",
        licenceExpiry: daysFromNow(365 * 3),
        licenceVerifiedAt: new Date(),
        passportNumber: `PA${String(7000000 + i * 101)}`,
        passportCountry: "AU",
        passportExpiry: daysFromNow(365 * 5),
        passportVerifiedAt: new Date(),
        addressLine1: `${i * 17} Ocean Ave`,
        suburb: "Noosa Heads",
        state: "QLD",
        postcode: "4567",
      },
    });
    customers.push(u);
  }

  // Vehicles (25+)
  const makes: Array<{
    make: string;
    model: string;
    cc: number;
    useCases: Prisma.VehicleModelCreateInput["useCases"];
  }> = [
    { make: "Honda", model: "Dio", cc: 50, useCases: { set: ["DELIVERY", "COMMUTING"] } },
    { make: "Yamaha", model: "Vino", cc: 50, useCases: { set: ["COMMUTING", "DELIVERY"] } },
    { make: "SYM", model: "Fiddle", cc: 100, useCases: { set: ["COMMUTING", "DELIVERY"] } },
    { make: "Kymco", model: "Agility", cc: 100, useCases: { set: ["COMMUTING", "DELIVERY"] } },
    { make: "Honda", model: "PCX", cc: 125, useCases: { set: ["COMMUTING", "DELIVERY"] } },
    { make: "Yamaha", model: "NMAX", cc: 125, useCases: { set: ["COMMUTING", "DELIVERY"] } },
    { make: "Vespa", model: "Primavera", cc: 125, useCases: { set: ["COMMUTING"] } },
    { make: "Piaggio", model: "Liberty", cc: 150, useCases: { set: ["COMMUTING"] } },
    { make: "Honda", model: "SH150", cc: 150, useCases: { set: ["COMMUTING", "DELIVERY"] } },
    { make: "Yamaha", model: "XMAX", cc: 300, useCases: { set: ["COMMUTING"] } },
  ];

  // Catalogue rows — one per unique make/model at a 2024 reference year.
  // Every vehicle of that make+model links to the same catalogue row
  // regardless of individual year; specs remain null until enrichment runs.
  const CATALOGUE_YEAR = 2024;
  const vehicleModelBySlug = new Map<string, string>();
  for (const m of makes) {
    const category = categories.find((c) => c.engineCapacity === m.cc) ?? categories[0]!;
    const slug = `${m.make.toLowerCase()}-${m.model.toLowerCase().replace(/\s+/g, "-")}-${m.cc}-${CATALOGUE_YEAR}`;
    const catalogueRow = await prisma.vehicleModel.upsert({
      where: { slug },
      update: { useCases: m.useCases },
      create: {
        make: m.make,
        model: m.model,
        year: CATALOGUE_YEAR,
        slug,
        categoryId: category.id,
        specsConfidence: "UNVERIFIED",
        useCases: m.useCases,
      },
    });
    vehicleModelBySlug.set(`${m.make}|${m.model}`, catalogueRow.id);
  }
  const colours = ["Red", "Blue", "White", "Black", "Silver", "Green"];
  const statuses: VehicleStatus[] = ["AVAILABLE", "AVAILABLE", "AVAILABLE", "AVAILABLE", "RENTED", "IN_MAINTENANCE"];

  const vehicles = [];
  for (let i = 0; i < 28; i++) {
    const m = makes[i % makes.length]!;
    const cat = categories.find((c) => c.engineCapacity === m.cc) ?? categories[0]!;
    const depot = depots[i % depots.length]!;
    const stateCode = depot.state === "QLD" ? "QLD" : "NSW";
    const rego = stateCode === "QLD"
      ? `${String(100 + i)}-${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + ((i + 1) % 26))}${(i % 9) + 1}`
      : `${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + ((i + 1) % 26))}-${String(10 + (i % 90))}-${String.fromCharCode(65 + ((i + 2) % 26))}${String.fromCharCode(65 + ((i + 3) % 26))}`;

    const vehicleYear = 2020 + (i % 6);
    const linkedModelId = vehicleModelBySlug.get(`${m.make}|${m.model}`) ?? null;
    const v = await prisma.vehicle.create({
      data: {
        internalCode: `SCT-${String(i + 1).padStart(3, "0")}`,
        rego,
        regoState: stateCode,
        regoExpiry: new Date(2027, (i % 12), (i % 27) + 1),
        vin: `VIN${String(100000 + i)}XYZ${i}`,
        engineNumber: `ENG${100000 + i}`,
        make: m.make,
        model: m.model,
        year: vehicleYear,
        colour: rand(colours),
        categoryId: cat.id,
        modelId: linkedModelId,
        depotId: depot.id,
        status: rand(statuses),
        currentOdometerKm: 500 + i * 1500,
        purchaseDate: new Date(2020 + (i % 6), 0, 1),
        purchasePrice: 4000 + i * 150,
        depreciationMethod: "STRAIGHT_LINE",
        depreciationRate: 15,
        currentBookValue: 3500 + i * 100,
        insurancePolicyNumber: `POL-${10000 + i}`,
        insuranceExpiry: new Date(2027, (i % 12), (i % 27) + 1),
        ctpExpiry: new Date(2027, (i % 12), (i % 27) + 1),
        lastServiceDate: new Date(2026, Math.max(0, (i - 1) % 12), 1),
        lastServiceKm: i * 1000,
        nextServiceDueKm: (i + 1) * 3000,
        nextServiceDueDate: new Date(2026, (i + 3) % 12, 15),
      },
    });
    vehicles.push(v);
  }

  // Bookings (50+)
  const addons = await prisma.addon.findMany();
  // Post-checkout statuses must have a vehicle allocated — mirrors the
  // Booking_vehicle_required_after_checkout_chk constraint. Pre-checkout
  // statuses leave vehicleId null so the quote/availability paths still
  // resemble real bookings that haven't been allocated yet.
  const VEHICLE_REQUIRED_STATUSES: BookingStatus[] = [
    "CHECKED_OUT",
    "ACTIVE",
    "OVERDUE",
    "RETURNED",
    "COMPLETED",
  ];
  for (let i = 0; i < 55; i++) {
    const customer = customers[i % customers.length]!;
    const cat = categories[i % categories.length]!;
    const depot = depots[i % depots.length]!;
    const duration = 1 + (i % 14);
    const base = new Date();
    base.setDate(base.getDate() + (i - 25)); // past & future
    const pickup = new Date(base);
    const ret = new Date(base);
    ret.setDate(ret.getDate() + duration);

    const subtotal = Number(cat.baseDailyRate) * duration;
    const gst = subtotal / 11;
    const status: BookingStatus = rand([
      "COMPLETED", "COMPLETED", "COMPLETED", "CONFIRMED", "ACTIVE", "CANCELLED", "PENDING_PAYMENT",
    ] as BookingStatus[]);

    let assignedVehicle: (typeof vehicles)[number] | null = null;
    if (VEHICLE_REQUIRED_STATUSES.includes(status)) {
      const exactMatch = vehicles.filter(
        (v) => v.depotId === depot.id && v.categoryId === cat.id,
      );
      const depotMatch = vehicles.filter((v) => v.depotId === depot.id);
      const pool = exactMatch.length > 0 ? exactMatch : depotMatch.length > 0 ? depotMatch : vehicles;
      assignedVehicle = pool[i % pool.length] ?? null;
    }

    const booking = await prisma.booking.create({
      data: {
        bookingReference: bookingRef(i),
        customerId: customer.id,
        categoryId: cat.id,
        vehicleId: assignedVehicle?.id,
        depotId: depot.id,
        pickupDepotId: depot.id,
        returnDepotId: depot.id,
        status,
        source: rand(["WEBSITE", "WALK_IN", "PHONE"] as const),
        pickupDateTime: pickup,
        returnDateTime: ret,
        actualPickupDateTime: assignedVehicle ? pickup : undefined,
        pickupOdometerKm: assignedVehicle?.currentOdometerKm,
        durationDays: duration,
        subtotal,
        gstAmount: gst,
        totalAmount: subtotal,
        amountPaid: status === "PENDING_PAYMENT" ? 0 : subtotal,
        balanceDue: status === "PENDING_PAYMENT" ? subtotal : 0,
        bondAmount: cat.bondAmount,
        agreedToTerms: true,
        termsVersion: "v1.0",
        createdById: admin.id,
        checkedOutById: assignedVehicle ? admin.id : undefined,
      },
    });

    const helmet = addons.find((a) => a.type === "HELMET");
    if (helmet) {
      await prisma.bookingAddon.create({
        data: {
          bookingId: booking.id,
          addonId: helmet.id,
          quantity: 1,
          unitPrice: Number(helmet.dailyRate ?? 5),
          totalPrice: Number(helmet.dailyRate ?? 5) * duration,
        },
      });
    }
  }

  // Maintenance work orders (15)
  for (let i = 0; i < 15; i++) {
    const v = vehicles[i % vehicles.length]!;
    await prisma.maintenanceWorkOrder.create({
      data: {
        workOrderNumber: `WO-${String(100000 + i)}`,
        vehicleId: v.id,
        depotId: v.depotId,
        type: rand(["ROUTINE_SERVICE", "TYRE_REPLACEMENT", "BRAKE_SERVICE", "BATTERY"] as const),
        priority: rand(["LOW", "MEDIUM", "HIGH"] as const),
        status: rand(["OPEN", "ASSIGNED", "IN_PROGRESS", "COMPLETED"] as const),
        title: "Scheduled maintenance",
        description: "Routine check and servicing",
        estimatedHours: 2,
        estimatedCost: 180,
        reportedById: admin.id,
      },
    });
  }

  const { SETTING_DEFAULTS, SETTING_GROUP_FOR, SETTING_DESCRIPTIONS } = await import(
    "../src/lib/settings-defaults"
  );
  for (const key of Object.keys(SETTING_DEFAULTS) as (keyof typeof SETTING_DEFAULTS)[]) {
    await prisma.systemSetting.upsert({
      where: { key },
      create: {
        key,
        group: SETTING_GROUP_FOR[key],
        description: SETTING_DESCRIPTIONS[key],
        value: SETTING_DEFAULTS[key] as Prisma.InputJsonValue,
      },
      update: {},
    });
  }

  // Feature flags gating the booking-wizard refactor. Seeded disabled so
  // existing behaviour is preserved; flipped in admin once each piece
  // ships and is ready to roll. `update: {}` preserves any value already
  // toggled in the running environment.
  const WIZARD_FEATURE_FLAGS: Array<{ key: string; description: string }> = [
    {
      key: "wizard_mobile_shell",
      description:
        "Renders the purpose-built mobile shell (full-screen per step + sticky bottom CTA + sheet summary) instead of the responsive desktop layout on ≤767px viewports.",
    },
    {
      key: "wizard_inline_auth",
      description:
        "Customer wizard Step 4 renders inline OAuth + register + sign-in panels instead of redirecting to /login or /register.",
    },
    {
      key: "wizard_intl_licence_flow",
      description:
        "Replaces the licence-OR-passport toggle with an AU-licence-vs-(IDP+passport) gate in Step 4.",
    },
  ];
  for (const flag of WIZARD_FEATURE_FLAGS) {
    await prisma.featureFlag.upsert({
      where: { key: flag.key },
      create: { key: flag.key, description: flag.description, enabled: false },
      update: {},
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // QA fixtures — April 2026 anomaly-review plan
  //
  // Everything below is deterministic (no rand()) and designed to let you
  // exercise the new gates end-to-end without first clicking through a
  // full booking flow. Named with `QA-` prefixes so they're easy to spot
  // and filter out in lists.
  // ─────────────────────────────────────────────────────────────────

  // C5: one-way fee fixtures are intentionally skipped when the seed runs
  // against a single depot — a depot cannot have a one-way fee to itself.
  if (depots.length >= 2) {
    await prisma.oneWayFee.createMany({
      data: [
        { fromDepotId: gc.id, toDepotId: bb.id, feeAmount: 45, allowed: true, notes: "Standard Gold Coast → Byron Bay transfer" },
        { fromDepotId: bb.id, toDepotId: gc.id, feeAmount: 45, allowed: true, notes: "Standard Byron Bay → Gold Coast transfer" },
        { fromDepotId: gc.id, toDepotId: ns.id, feeAmount: 0, allowed: false, notes: "QA: one-way disallowed — too far on a scooter" },
        { fromDepotId: ns.id, toDepotId: gc.id, feeAmount: 0, allowed: false, notes: "QA: one-way disallowed — too far on a scooter" },
      ],
    });
  }

  // Pick a manager for inspector roles. Using the first staff member at GC.
  const gcManager = await prisma.user.findFirstOrThrow({
    where: { depotId: gc.id, role: "MANAGER" },
  });

  // A3/A4: customer with full R licence so 300cc fixtures work.
  const qaCustomer = await prisma.user.create({
    data: {
      email: "qa.customer@example.com",
      firstName: "QA",
      lastName: "Customer",
      passwordHash: custPw,
      role: "CUSTOMER",
      phone: "0400000001",
      dateOfBirth: new Date(1990, 0, 15),
      emailVerified: new Date(),
    },
  });
  await prisma.customerProfile.create({
    data: {
      userId: qaCustomer.id,
      licenceNumber: "99999999",
      licenceState: "QLD",
      licenceClass: "R",
      licenceExpiry: new Date(2030, 5, 30),
      licenceVerifiedAt: new Date(),
      addressLine1: "1 QA St",
      suburb: "Surfers Paradise",
      state: "QLD",
      postcode: "4217",
    },
  });

  // A2: vehicle with rego expiring before any realistic booking
  // return. Availability filter should now hide this vehicle from quote
  // and allocation paths. Parked at GC, DECOMMISSIONED off to keep the
  // QA vehicle out of normal dashboards.
  const expiredRegoCategory = categories[0]!; // 50cc
  await prisma.vehicle.create({
    data: {
      internalCode: "QA-EXPIRED",
      rego: "QA-EXP-1",
      regoState: "QLD",
      regoExpiry: new Date(2024, 11, 1), // well in the past
      vin: "QAVIN0000000EXP",
      make: "Honda",
      model: "Dio",
      year: 2019,
      colour: "Red",
      categoryId: expiredRegoCategory.id,
      depotId: gc.id,
      status: "AVAILABLE",
      currentOdometerKm: 12000,
      insuranceExpiry: new Date(2028, 0, 1),
      ctpExpiry: new Date(2028, 0, 1),
      notes: "QA: rego already expired. Should NOT appear in quote/availability queries.",
    },
  });

  // A5: scheduled work order in the near future so the availability
  // filter has a vehicle+window pair to exclude.
  const qaScheduledVehicle = vehicles.find(
    (v) => v.depotId === gc.id && v.status === "AVAILABLE",
  )!;
  const schedStart = new Date();
  schedStart.setDate(schedStart.getDate() + 3);
  schedStart.setHours(9, 0, 0, 0);
  const schedEnd = new Date(schedStart);
  schedEnd.setHours(13, 0, 0, 0);
  await prisma.maintenanceWorkOrder.create({
    data: {
      workOrderNumber: "QA-WO-SCHED-001",
      vehicleId: qaScheduledVehicle.id,
      depotId: gc.id,
      type: "ROUTINE_SERVICE",
      priority: "MEDIUM",
      status: "ASSIGNED",
      title: "QA: scheduled service window",
      description: "Blocks availability for the requested window. Used to test A5 filter.",
      scheduledStartAt: schedStart,
      scheduledEndAt: schedEnd,
      reportedById: admin.id,
      assignedToId: gcManager.id,
    },
  });

  // B1 + B2: a CONFIRMED booking with an existing PRE_HIRE inspection
  // so staff can exercise check-out end-to-end; and an OVERDUE booking
  // past stage 1 so the escalation ladder has a target on next run.
  const qaBookingVehicle = vehicles.find(
    (v) =>
      v.depotId === gc.id &&
      v.status === "AVAILABLE" &&
      v.id !== qaScheduledVehicle.id,
  )!;
  const pickupConfirmed = new Date();
  pickupConfirmed.setDate(pickupConfirmed.getDate() + 2);
  pickupConfirmed.setHours(10, 0, 0, 0);
  const returnConfirmed = new Date(pickupConfirmed);
  returnConfirmed.setDate(returnConfirmed.getDate() + 3);
  const confirmedCat = categories.find((c) => c.id === qaBookingVehicle.categoryId) ?? categories[0]!;
  const confirmedSubtotal = Number(confirmedCat.baseDailyRate) * 3;
  const qaConfirmedBooking = await prisma.booking.create({
    data: {
      bookingReference: "QA-CONFIRMED",
      customerId: qaCustomer.id,
      categoryId: qaBookingVehicle.categoryId,
      vehicleId: qaBookingVehicle.id,
      depotId: gc.id,
      pickupDepotId: gc.id,
      returnDepotId: gc.id,
      status: "CONFIRMED",
      source: "WEBSITE",
      pickupDateTime: pickupConfirmed,
      returnDateTime: returnConfirmed,
      durationDays: 3,
      subtotal: confirmedSubtotal,
      gstAmount: confirmedSubtotal / 11,
      totalAmount: confirmedSubtotal,
      amountPaid: confirmedSubtotal,
      balanceDue: 0,
      bondAmount: Number(confirmedCat.bondAmount),
      agreedToTerms: true,
      termsVersion: "v1.0",
      licenceVerified: true,
      customerIdVerified: true,
      createdById: admin.id,
      confirmedById: admin.id,
    },
  });
  await prisma.inspection.create({
    data: {
      vehicleId: qaBookingVehicle.id,
      bookingId: qaConfirmedBooking.id,
      type: "PRE_HIRE" satisfies InspectionType,
      inspectorId: gcManager.id,
      depotId: gc.id,
      odometerKm: qaBookingVehicle.currentOdometerKm,
      fuelLevel: 95,
      overallCondition: "GOOD" satisfies VehicleCondition,
      status: "COMPLETED" satisfies InspectionStatus,
      notes: "QA: pre-hire baseline for the CONFIRMED fixture. Check-out can proceed.",
    },
  });
  await prisma.bondLedger.create({
    data: {
      bookingId: qaConfirmedBooking.id,
      customerId: qaCustomer.id,
      heldAmount: Number(confirmedCat.bondAmount),
      status: "HELD",
    },
  });

  // B2: a booking whose return is already 14 hours in the past — the
  // next overdue-check tick should push it from OVERDUE (stage 1) to
  // stage 2 (second SMS). Status starts OVERDUE stage 1 so we don't
  // double-dip when the worker runs.
  const qaOverdueVehicle = vehicles.find(
    (v) =>
      v.depotId === gc.id &&
      v.status === "RENTED" &&
      v.id !== qaBookingVehicle.id &&
      v.id !== qaScheduledVehicle.id,
  ) ?? vehicles.find(
    (v) => v.depotId === gc.id && v.id !== qaBookingVehicle.id && v.id !== qaScheduledVehicle.id,
  )!;
  const overdueReturn = new Date();
  overdueReturn.setHours(overdueReturn.getHours() - 14);
  const overduePickup = new Date(overdueReturn);
  overduePickup.setDate(overduePickup.getDate() - 5);
  const overdueCat = categories.find((c) => c.id === qaOverdueVehicle.categoryId) ?? categories[0]!;
  const overdueSubtotal = Number(overdueCat.baseDailyRate) * 5;
  const qaOverdueBooking = await prisma.booking.create({
    data: {
      bookingReference: "QA-OVERDUE",
      customerId: qaCustomer.id,
      categoryId: qaOverdueVehicle.categoryId,
      vehicleId: qaOverdueVehicle.id,
      depotId: gc.id,
      pickupDepotId: gc.id,
      returnDepotId: gc.id,
      status: "OVERDUE",
      source: "WEBSITE",
      pickupDateTime: overduePickup,
      returnDateTime: overdueReturn,
      actualPickupDateTime: overduePickup,
      durationDays: 5,
      subtotal: overdueSubtotal,
      gstAmount: overdueSubtotal / 11,
      totalAmount: overdueSubtotal,
      amountPaid: overdueSubtotal,
      balanceDue: 0,
      bondAmount: Number(overdueCat.bondAmount),
      agreedToTerms: true,
      termsVersion: "v1.0",
      licenceVerified: true,
      customerIdVerified: true,
      overdueStage: 1,
      pickupOdometerKm: qaOverdueVehicle.currentOdometerKm,
      createdById: admin.id,
      confirmedById: admin.id,
      checkedOutById: admin.id,
    },
  });
  await prisma.inspection.create({
    data: {
      vehicleId: qaOverdueVehicle.id,
      bookingId: qaOverdueBooking.id,
      type: "PRE_HIRE",
      inspectorId: gcManager.id,
      depotId: gc.id,
      odometerKm: qaOverdueVehicle.currentOdometerKm,
      fuelLevel: 100,
      overallCondition: "GOOD",
      status: "COMPLETED",
    },
  });

  // D2: an incident on the overdue booking with customerLiable and a
  // charge amount pre-populated so the "charge customer" action has a
  // realistic target.
  await prisma.incident.create({
    data: {
      incidentNumber: "QA-INC-001",
      vehicleId: qaOverdueVehicle.id,
      bookingId: qaOverdueBooking.id,
      customerId: qaCustomer.id,
      type: "CUSTOMER_DAMAGE",
      severity: "MINOR",
      status: "ASSESSED",
      dateTime: new Date(),
      location: "Surfers Paradise foreshore",
      description:
        "QA fixture: scrape along left side panel. Customer reported. Ready for chargeCustomerForIncident() test.",
      reportedById: gcManager.id,
      customerLiable: true,
      estimatedDamageCost: 250,
      customerChargeAmount: 250,
    },
  });

  // D3: a nominated infringement ready for chargeCustomerForInfringement().
  await prisma.infringement.create({
    data: {
      vehicleId: qaOverdueVehicle.id,
      bookingId: qaOverdueBooking.id,
      customerId: qaCustomer.id,
      type: "SPEEDING",
      issuer: "QLD Police",
      referenceNumber: "QA-INFR-001",
      offenceDate: new Date(Date.now() - 3 * 86400000),
      amount: 187,
      status: "NOMINATED",
      nominatedAt: new Date(),
      dueDate: new Date(Date.now() + 21 * 86400000),
      notes: "QA fixture — ready to charge the customer.",
    },
  });

  // Damage tariff catalogue — pre-configured standard items staff can bill on the spot.
  const tariffs = [
    { code: "SCRATCH_MINOR", name: "Minor scratch (small panel)", defaultPrice: 45, severityHint: "MINOR" },
    { code: "SCRATCH_MODERATE", name: "Moderate scratch / dent", defaultPrice: 120, severityHint: "MODERATE" },
    { code: "DENT_PANEL", name: "Dented panel", defaultPrice: 180, severityHint: "MODERATE" },
    { code: "MIRROR_REPLACE", name: "Mirror replacement", defaultPrice: 180, severityHint: "MINOR" },
    { code: "INDICATOR_LENS", name: "Broken indicator lens", defaultPrice: 95, severityHint: "MINOR" },
    { code: "HELMET_REPLACE", name: "Helmet replacement", defaultPrice: 80, severityHint: "MINOR" },
    { code: "MISSING_KEY", name: "Missing key", defaultPrice: 150, severityHint: "MINOR" },
    { code: "HEAVY_SOILING", name: "Heavy soiling / cleaning fee", defaultPrice: 50, severityHint: "MINOR" },
    { code: "GRIP_REPLACE", name: "Grip / handlebar replacement", defaultPrice: 35, severityHint: "MINOR" },
    { code: "WINDSCREEN", name: "Windscreen replacement", defaultPrice: 220, severityHint: "MODERATE" },
  ] as const;
  for (const [i, t] of tariffs.entries()) {
    await prisma.damageTariff.upsert({
      where: { code: t.code },
      create: {
        code: t.code,
        name: t.name,
        defaultPrice: t.defaultPrice,
        severityHint: t.severityHint,
        displayOrder: i,
      },
      update: { name: t.name, defaultPrice: t.defaultPrice, severityHint: t.severityHint, displayOrder: i },
    });
  }

  // ---------------------------------------------------------------------
  // Notification templates
  //
  // Each template has:
  //   - `bodyTemplate` — short plain-text body used for SMS / IN_APP / PUSH
  //     channels AND as a plain-text alternative for EMAIL deliverability.
  //   - `emailBodyHtml` — mobile-responsive rich HTML body used for the
  //     EMAIL channel only. Wrapped in `renderEmailShell()` which supplies
  //     the branded logo header, policy footer (terms / privacy / refund
  //     / contact) and the `@media (max-width: 600px)` mobile layout.
  //
  // Branding vars (`{{siteName}}`, `{{logoUrl}}`, `{{termsUrl}}`,
  // `{{legalName}}`, `{{abn}}`, `{{supportEmail}}`, `{{currentYear}}`,
  // etc.) are auto-injected by `notification-sender.ts` at dispatch time
  // via `getEmailBrandingVars()`, so templates reference them as
  // placeholders without hardcoding trading names or ABNs.
  // ---------------------------------------------------------------------
  const templateSeed: Array<{
    key: string;
    type: NotificationType;
    category: NotificationCategory;
    name: string;
    description: string;
    channels: NotificationChannel[];
    subject: string | null;
    bodyTemplate: string;
    emailBodyHtml?: string;
    variables: string[];
  }> = [
    {
      key: "booking-confirmation",
      type: "BOOKING_CONFIRMATION",
      category: "TRANSACTIONAL",
      name: "Booking confirmed",
      description: "Sent when a booking is paid and confirmed.",
      channels: ["EMAIL", "SMS"],
      subject: "Your booking {{bookingReference}} is confirmed",
      bodyTemplate:
        "Hi {{firstName}}, your {{siteName}} booking {{bookingReference}} is confirmed. Pickup {{pickupAt}} at {{depotName}}, return {{returnAt}}. Total A${{totalAud}}.",
      emailBodyHtml: renderEmailShell({
        preheader: "Pickup {{pickupAt}} at {{depotName}}",
        eyebrow: "Booking confirmed",
        title: "You're booked in, {{firstName}}!",
        body:
          paragraphs(
            "Thanks for booking with {{siteName}}. We've locked in your ride and we'll see you at pickup.",
          ) +
          summaryTable([
            { label: "Reference", value: "{{bookingReference}}" },
            { label: "Pickup", value: "{{pickupAt}}" },
            { label: "Return", value: "{{returnAt}}" },
            { label: "Depot", value: "{{depotName}}" },
            { label: "Total (inc. GST)", value: "A${{totalAud}}" },
          ]) +
          paragraphs(
            "Bring your physical driver's licence and a helmet if you have one (we'll provide one if you don't).",
          ),
        cta: { label: "View booking", url: "{{appUrl}}/dashboard/bookings" },
        ctaFootnote: "Need to change anything? Reply to this email or contact {{supportEmail}}.",
      }),
      variables: ["firstName", "bookingReference", "pickupAt", "returnAt", "depotName", "totalAud"],
    },
    {
      key: "booking-reminder",
      type: "BOOKING_REMINDER",
      category: "TRANSACTIONAL",
      name: "Booking reminder (24h)",
      description: "Pickup reminder sent 24 hours before the booking starts.",
      channels: ["EMAIL", "SMS"],
      subject: "See you tomorrow — {{bookingReference}}",
      bodyTemplate:
        "Hi {{firstName}}, reminder: your {{siteName}} pickup is tomorrow at {{pickupAt}} at {{depotName}}. Don't forget your licence!",
      emailBodyHtml: renderEmailShell({
        preheader: "Pickup tomorrow at {{pickupAt}}",
        eyebrow: "See you tomorrow",
        title: "Your ride starts in 24 hours",
        body:
          paragraphs(
            "Hi {{firstName}}, just a heads-up that your {{siteName}} pickup is tomorrow. Here's everything you'll need:",
          ) +
          summaryTable([
            { label: "Reference", value: "{{bookingReference}}" },
            { label: "When", value: "{{pickupAt}}" },
            { label: "Where", value: "{{depotName}}" },
          ]) +
          paragraphs(
            "Bring your <strong>physical driver's licence</strong> — we can't legally hire without it. Running late or need to reschedule? Tap below.",
          ),
        cta: { label: "Manage booking", url: "{{appUrl}}/dashboard/bookings" },
      }),
      variables: ["firstName", "bookingReference", "pickupAt", "depotName"],
    },
    {
      key: "payment-received",
      type: "PAYMENT_RECEIVED",
      category: "TRANSACTIONAL",
      name: "Payment received",
      description: "Sent on successful Stripe charge.",
      channels: ["EMAIL"],
      subject: "Payment received — {{paymentReference}}",
      bodyTemplate:
        "Hi {{firstName}}, we've received your payment of A${{amountAud}}. Reference: {{paymentReference}}.",
      emailBodyHtml: renderEmailShell({
        preheader: "A${{amountAud}} received. Reference {{paymentReference}}",
        eyebrow: "Payment received",
        title: "Thanks, {{firstName}}!",
        body:
          paragraphs(
            "We've received your payment. Keep this email as a record — an official tax invoice is available in your account.",
          ) +
          summaryTable([
            { label: "Amount", value: "A${{amountAud}}" },
            { label: "Reference", value: "{{paymentReference}}" },
          ]),
        cta: { label: "View receipts", url: "{{appUrl}}/dashboard/documents" },
      }),
      variables: ["firstName", "amountAud", "paymentReference"],
    },
    {
      key: "invoice-issued",
      type: "INVOICE_ISSUED",
      category: "TRANSACTIONAL",
      name: "Invoice issued",
      description: "Attached PDF invoice.",
      channels: ["EMAIL"],
      subject: "Invoice {{invoiceNumber}} from {{siteName}}",
      bodyTemplate:
        "Hi {{firstName}}, your {{siteName}} invoice {{invoiceNumber}} for A${{totalAud}} is attached.",
      emailBodyHtml: renderEmailShell({
        preheader: "Invoice {{invoiceNumber}} · A${{totalAud}}",
        eyebrow: "Invoice issued",
        title: "Invoice {{invoiceNumber}}",
        body:
          paragraphs(
            "Hi {{firstName}}, your tax invoice is attached to this email for your records. The total includes GST.",
          ) +
          summaryTable([
            { label: "Invoice", value: "{{invoiceNumber}}" },
            { label: "Amount", value: "A${{totalAud}}" },
          ]) +
          paragraphs(
            "Any questions about charges? Reply to this email or contact {{supportEmail}}.",
          ),
        cta: { label: "View all invoices", url: "{{appUrl}}/dashboard/documents" },
      }),
      variables: ["firstName", "invoiceNumber", "totalAud"],
    },
    {
      key: "bond-released",
      type: "BOND_RELEASED",
      category: "TRANSACTIONAL",
      name: "Bond released",
      description: "Sent when the bond hold is released back to the customer.",
      channels: ["EMAIL"],
      subject: "Your {{siteName}} bond has been released",
      bodyTemplate:
        "Hi {{firstName}}, good news — your A${{amount}} bond hold for booking {{bookingReference}} has been released.",
      emailBodyHtml: renderEmailShell({
        preheader: "A${{amount}} returned to your card",
        eyebrow: "Bond released",
        title: "Your bond is back on your card",
        body:
          paragraphs(
            "Hi {{firstName}}, your bond hold from booking {{bookingReference}} has been released. Depending on your bank it can take 3–5 business days to clear.",
          ) +
          summaryTable([
            { label: "Bond released", value: "A${{amount}}" },
            { label: "Booking", value: "{{bookingReference}}" },
          ]) +
          paragraphs(
            "Thanks for riding with us. We hope to see you again soon.",
          ),
        cta: { label: "Book your next ride", url: "{{appUrl}}/fleet" },
      }),
      variables: ["firstName", "amount", "bookingReference"],
    },
    {
      key: "lease-agreement-copy",
      type: "LEASE_AGREEMENT_COPY",
      category: "TRANSACTIONAL",
      name: "Lease agreement copy",
      description: "On-demand copy of the signed rental agreement.",
      channels: ["EMAIL"],
      subject: "Copy of your rental agreement — {{bookingReference}}",
      bodyTemplate:
        "Hi {{firstName}}, attached is a copy of your signed rental agreement for booking {{bookingReference}}.",
      emailBodyHtml: renderEmailShell({
        preheader: "Signed rental agreement for {{bookingReference}}",
        eyebrow: "Rental agreement",
        title: "Your signed agreement",
        body:
          paragraphs(
            "Hi {{firstName}}, a signed copy of your rental agreement for booking <strong>{{bookingReference}}</strong> is attached to this email. Keep it handy while your hire is active.",
          ) +
          paragraphs(
            "Need another copy later? You can always download it from your account.",
          ),
        cta: { label: "Open my documents", url: "{{appUrl}}/dashboard/documents" },
      }),
      variables: ["firstName", "bookingReference"],
    },
    {
      key: "return-paperwork-copy",
      type: "RETURN_PAPERWORK_COPY",
      category: "TRANSACTIONAL",
      name: "Return paperwork copy",
      description: "On-demand copy of return inspection + final invoice.",
      channels: ["EMAIL"],
      subject: "Return paperwork — {{bookingReference}}",
      bodyTemplate:
        "Hi {{firstName}}, attached is the return paperwork for booking {{bookingReference}}, including the post-hire inspection and final statement.",
      emailBodyHtml: renderEmailShell({
        preheader: "Post-hire inspection + final statement",
        eyebrow: "Return paperwork",
        title: "Your return pack",
        body:
          paragraphs(
            "Hi {{firstName}}, attached is your post-hire inspection and final statement for booking <strong>{{bookingReference}}</strong>. It includes any outstanding charges or bond adjustments.",
          ) +
          paragraphs(
            "Questions about a line on the statement? Hit reply or email {{supportEmail}} — we'll walk you through it.",
          ),
      }),
      variables: ["firstName", "bookingReference"],
    },
    {
      key: "profile-updated-self",
      type: "PROFILE_UPDATED_SELF",
      category: "ACCOUNT",
      name: "Profile updated (self)",
      description: "Confirms the customer's own changes to their profile.",
      channels: ["EMAIL"],
      subject: "Your {{siteName}} profile was updated",
      bodyTemplate:
        "Hi {{firstName}}, this confirms changes to your profile: {{fields}}. If this wasn't you, please contact us.",
      emailBodyHtml: renderEmailShell({
        preheader: "Confirming changes to your account",
        eyebrow: "Account update",
        title: "Profile changes confirmed",
        body:
          paragraphs(
            "Hi {{firstName}}, this is just a heads-up that the following were updated on your account: <strong>{{fields}}</strong>.",
          ) +
          paragraphs(
            "If you made these changes, there's nothing to do. If you didn't, please reset your password and contact {{supportEmail}} straight away.",
          ),
        cta: { label: "Review my account", url: "{{appUrl}}/dashboard/profile" },
      }),
      variables: ["firstName", "fields"],
    },
    {
      key: "profile-updated-staff",
      type: "PROFILE_UPDATED_STAFF",
      category: "ACCOUNT",
      name: "Profile updated (by staff)",
      description: "Alerts the customer that staff edited their profile.",
      channels: ["EMAIL"],
      subject: "Your {{siteName}} profile was updated by our team",
      bodyTemplate:
        "Hi {{firstName}}, our team updated the following on your account: {{fields}}. If this wasn't expected, please contact us.",
      emailBodyHtml: renderEmailShell({
        preheader: "Our team made changes to your account",
        eyebrow: "Account update",
        title: "Our team updated your profile",
        body:
          paragraphs(
            "Hi {{firstName}}, our team made the following changes to your account: <strong>{{fields}}</strong>. This is usually to reflect information you gave us over the phone, at pickup, or during a support chat.",
          ) +
          paragraphs(
            "If you weren't expecting this, reply to this email or contact {{supportEmail}} and we'll sort it out.",
          ),
        cta: { label: "Review my account", url: "{{appUrl}}/dashboard/profile" },
      }),
      variables: ["firstName", "fields"],
    },
    {
      key: "licence-expiring",
      type: "LICENCE_EXPIRING",
      category: "ACCOUNT",
      name: "Licence expiring",
      description: "Flags a licence that's within 30 days of expiry.",
      channels: ["EMAIL"],
      subject: "Your driver's licence is expiring soon",
      bodyTemplate:
        "Hi {{firstName}}, our records show your driver's licence expires on {{expiryDate}}. Please update us before your next booking.",
      emailBodyHtml: renderEmailShell({
        preheader: "Your licence expires {{expiryDate}}",
        eyebrow: "Action required",
        title: "Your licence is about to expire",
        body:
          paragraphs(
            "Hi {{firstName}}, our records show your driver's licence expires on <strong>{{expiryDate}}</strong>. To keep riding with us, please upload your renewed licence before your next booking — we can't legally hire without a current licence.",
          ),
        cta: { label: "Upload renewed licence", url: "{{appUrl}}/dashboard/profile" },
        ctaFootnote: "Already renewed? Upload the new card and you're all set.",
      }),
      variables: ["firstName", "expiryDate"],
    },
    {
      key: "infringement-nominated",
      type: "INFRINGEMENT_NOMINATED",
      category: "TRANSACTIONAL",
      name: "Infringement nominated",
      description: "Tells the customer they've been nominated as the driver on an infringement.",
      channels: ["EMAIL"],
      subject: "Action required: infringement nominated to you",
      bodyTemplate:
        "Hi {{firstName}}, infringement {{referenceNumber}} issued on {{offenceDate}} during your hire has been nominated to you. Charge: A${{amount}}. See your portal for details.",
      emailBodyHtml: renderEmailShell({
        preheader: "Infringement {{referenceNumber}} has been nominated to you",
        eyebrow: "Action required",
        title: "We've nominated you as the driver",
        body:
          paragraphs(
            "Hi {{firstName}}, we've received an infringement notice from the issuing authority for an offence during your hire. By law, the registered operator must nominate the person driving at the time — that was you.",
          ) +
          summaryTable([
            { label: "Reference", value: "{{referenceNumber}}" },
            { label: "Offence date", value: "{{offenceDate}}" },
            { label: "Amount", value: "A${{amount}}" },
          ]) +
          paragraphs(
            "Full details, including a copy of the original notice, are available in your portal. If you believe the nomination is in error, contact us within 14 days — after that, the authority considers it final.",
          ),
        cta: { label: "Open infringement", url: "{{appUrl}}/dashboard" },
      }),
      variables: ["firstName", "referenceNumber", "offenceDate", "amount"],
    },
    {
      key: "marketing-promotional",
      type: "MARKETING_PROMOTIONAL",
      category: "MARKETING",
      name: "Generic promo",
      description: "Shell for ad-hoc promotional broadcasts.",
      channels: ["EMAIL", "SMS"],
      subject: "{{subject}}",
      bodyTemplate: "{{body}}",
      emailBodyHtml: renderEmailShell({
        preheader: "{{subject}}",
        title: "{{subject}}",
        body: paragraphs("{{{body}}}"),
        cta: { label: "Book your next ride", url: "{{appUrl}}/fleet" },
        footerNote:
          `You're receiving this because you opted in to {{siteName}} marketing. <a href="{{unsubscribeUrl}}" style="color:#666;text-decoration:underline;">Unsubscribe</a>.`,
      }),
      variables: ["subject", "body"],
    },
    {
      key: "marketing-birthday",
      type: "MARKETING_BIRTHDAY",
      category: "MARKETING",
      name: "Birthday discount",
      description: "Wishes customers a happy birthday + 10% off next hire.",
      channels: ["EMAIL"],
      subject: "Happy birthday from {{siteName}}",
      bodyTemplate:
        "Hi {{firstName}}, happy birthday! Use code SCOOT10 for 10% off your next hire this month.",
      emailBodyHtml: renderEmailShell({
        preheader: "10% off your next ride, on us",
        eyebrow: "Happy birthday",
        title: "It's your day, {{firstName}}",
        body:
          paragraphs(
            "Here's a little something from us: <strong>10% off your next {{siteName}} hire</strong>, any depot, any bike.",
          ) +
          paragraphs(
            "Use code <strong>SCOOT10</strong> at checkout. Valid this month only.",
          ),
        cta: { label: "Find your ride", url: "{{appUrl}}/fleet" },
        footerNote:
          `Birthdays aren't spam, but if you'd rather not get them <a href="{{unsubscribeUrl}}" style="color:#666;text-decoration:underline;">update your preferences</a>.`,
      }),
      variables: ["firstName"],
    },
    {
      key: "marketing-winback",
      type: "MARKETING_WINBACK",
      category: "MARKETING",
      name: "Winback — 180d",
      description: "Targets customers who haven't rented in 180+ days.",
      channels: ["EMAIL"],
      subject: "We miss you — 15% off your next ride",
      bodyTemplate:
        "Hi {{firstName}}, it's been a while! Use WELCOMEBACK15 for 15% off your next hire in any depot.",
      emailBodyHtml: renderEmailShell({
        preheader: "15% off to bring you back on the road",
        eyebrow: "We miss you",
        title: "Been a while, {{firstName}}",
        body:
          paragraphs(
            "It's been six months since your last ride with {{siteName}}. We'd love to have you back on the road.",
          ) +
          paragraphs(
            "Use code <strong>WELCOMEBACK15</strong> for <strong>15% off your next hire</strong>, any depot. Valid for the next 30 days.",
          ),
        cta: { label: "Browse the fleet", url: "{{appUrl}}/fleet" },
        footerNote:
          `Not for you any more? <a href="{{unsubscribeUrl}}" style="color:#666;text-decoration:underline;">Unsubscribe</a> from marketing anytime.`,
      }),
      variables: ["firstName"],
    },
    {
      key: "support_ticket_assigned",
      type: "SUPPORT_TICKET_ASSIGNED",
      category: "OPERATIONAL",
      name: "Support — ticket assigned",
      description: "Sent to the assignee when a support ticket is created or assigned.",
      channels: ["EMAIL", "IN_APP"],
      subject: "Support ticket assigned — {{ticketNumber}}",
      bodyTemplate:
        "Ticket {{ticketNumber}} ({{category}}) from {{customerName}} ({{depotName}}): {{summary}}. Open: {{ticketUrl}}",
      emailBodyHtml: renderEmailShell({
        preheader: "{{category}} ticket from {{customerName}}",
        eyebrow: "Support",
        title: "Ticket {{ticketNumber}} assigned to you",
        body:
          summaryTable([
            { label: "Customer", value: "{{customerName}}" },
            { label: "Depot", value: "{{depotName}}" },
            { label: "Category", value: "{{category}}" },
            { label: "Summary", value: "{{summary}}" },
          ]),
        cta: { label: "Open ticket", url: "{{ticketUrl}}" },
      }),
      variables: ["ticketNumber", "category", "customerName", "summary", "depotName", "ticketUrl"],
    },
    {
      key: "support_ticket_urgent_paging",
      type: "SUPPORT_TICKET_URGENT",
      category: "OPERATIONAL",
      name: "Support — urgent on-call paging",
      description: "SMS + EMAIL fanned to on-call for URGENT breakdown / abandoned tickets.",
      channels: ["SMS", "EMAIL", "IN_APP"],
      subject: "URGENT — {{category}} {{ticketNumber}}",
      bodyTemplate:
        "URGENT {{siteName}}: {{customerName}} — {{summary}}. Respond now: {{ticketUrl}}",
      emailBodyHtml: renderEmailShell({
        preheader: "URGENT — respond now",
        eyebrow: "URGENT · On-call page",
        title: "{{category}} — {{ticketNumber}}",
        body:
          paragraphs(
            "<strong>Immediate response required.</strong>",
          ) +
          summaryTable([
            { label: "Customer", value: "{{customerName}}" },
            { label: "Summary", value: "{{summary}}" },
          ]),
        cta: { label: "Open ticket now", url: "{{ticketUrl}}" },
      }),
      variables: ["ticketNumber", "category", "customerName", "summary", "ticketUrl"],
    },
    {
      key: "support_ticket_customer_reply",
      type: "SUPPORT_TICKET_CUSTOMER_REPLY",
      category: "TRANSACTIONAL",
      name: "Support — staff replied",
      description: "Sent to the customer when support staff reply on their ticket.",
      channels: ["EMAIL", "IN_APP"],
      subject: "Reply on your {{siteName}} support ticket {{ticketNumber}}",
      bodyTemplate:
        "Hi {{customerName}}, our team replied on {{ticketNumber}}: {{replyBody}}. View: {{portalUrl}}",
      emailBodyHtml: renderEmailShell({
        preheader: "New reply on ticket {{ticketNumber}}",
        eyebrow: "Support reply",
        title: "We've got back to you",
        body:
          paragraphs(
            "Hi {{customerName}}, our team replied on your ticket <strong>{{ticketNumber}}</strong>:",
          ) +
          `<blockquote style="margin:0 0 16px 0;padding:12px 16px;border-left:3px solid #1B6B4A;background:#F4F4F1;color:#111;font-size:14px;">{{{replyBody}}}</blockquote>` +
          paragraphs(
            "Pick up the conversation in your customer portal — you can reply from there and we'll get back to you.",
          ),
        cta: { label: "Open ticket", url: "{{portalUrl}}" },
      }),
      variables: ["ticketNumber", "customerName", "replyBody", "portalUrl"],
    },
    {
      key: "support_ticket_resolved",
      type: "SUPPORT_TICKET_RESOLVED",
      category: "TRANSACTIONAL",
      name: "Support — ticket resolved",
      description: "Customer confirmation when a support ticket is resolved, with CSAT CTA.",
      channels: ["EMAIL", "IN_APP"],
      subject: "Your {{siteName}} support ticket is resolved ({{ticketNumber}})",
      bodyTemplate:
        "Hi {{customerName}}, we've resolved your ticket {{ticketNumber}} ({{summary}}). How did we do? {{feedbackUrl}}",
      emailBodyHtml: renderEmailShell({
        preheader: "Ticket {{ticketNumber}} resolved",
        eyebrow: "Resolved",
        title: "All sorted",
        body:
          paragraphs(
            "Hi {{customerName}}, we've marked your ticket <strong>{{ticketNumber}}</strong> as resolved.",
          ) +
          summaryTable([{ label: "What was it about", value: "{{summary}}" }]) +
          paragraphs(
            "One quick favour — tell us how we did. It takes under a minute and genuinely helps us get better.",
          ),
        cta: { label: "Leave feedback", url: "{{feedbackUrl}}" },
      }),
      variables: ["ticketNumber", "customerName", "summary", "feedbackUrl"],
    },
  ];

  for (const t of templateSeed) {
    // bodyTemplate is always plain-text (SMS/in-app friendly); the EMAIL
    // channel uses emailBodyHtml when set.
    await prisma.notificationTemplate.upsert({
      where: { key: t.key },
      create: {
        key: t.key,
        type: t.type,
        category: t.category,
        name: t.name,
        description: t.description,
        channels: t.channels,
        subject: t.subject,
        bodyTemplate: t.bodyTemplate,
        emailBodyHtml: t.emailBodyHtml ?? null,
        format: "PLAIN_TEXT",
        variables: t.variables,
        isActive: true,
      },
      update: {
        name: t.name,
        description: t.description,
        category: t.category,
        type: t.type,
        channels: t.channels,
        subject: t.subject,
        bodyTemplate: t.bodyTemplate,
        emailBodyHtml: t.emailBodyHtml ?? null,
        format: "PLAIN_TEXT",
        variables: t.variables,
      },
    });
  }

  // ---------------------------------------------------------------------
  // Notification automations — enabled list
  // ---------------------------------------------------------------------
  const automationTypes: Array<{ type: NotificationType; channels: NotificationChannel[]; description: string }> = [
    { type: "BOOKING_CONFIRMATION",  channels: ["EMAIL", "SMS"], description: "Sent at booking confirmation" },
    { type: "BOOKING_REMINDER",      channels: ["EMAIL", "SMS"], description: "Daily 07:00, 24h before pickup" },
    { type: "BOOKING_DUE_TODAY",     channels: ["SMS"],          description: "Morning of return date" },
    { type: "BOOKING_OVERDUE",       channels: ["EMAIL", "SMS"], description: "When > 1h late" },
    { type: "PAYMENT_RECEIVED",      channels: ["EMAIL"],        description: "Stripe charge succeeded" },
    { type: "BOND_RELEASED",         channels: ["EMAIL"],        description: "14d after return (configurable)" },
    { type: "LICENCE_EXPIRING",      channels: ["EMAIL"],        description: "30/14/7 days before expiry" },
    { type: "INFRINGEMENT_NOMINATED", channels: ["EMAIL"],       description: "On nomination" },
    { type: "PROFILE_UPDATED_SELF",  channels: ["EMAIL"],        description: "Customer edits own profile" },
    { type: "PROFILE_UPDATED_STAFF", channels: ["EMAIL"],        description: "Staff edits customer profile" },
    { type: "DAILY_OPS_SUMMARY",     channels: ["EMAIL"],        description: "Daily 07:00 to managers" },
    { type: "WEEKLY_REVENUE_SUMMARY", channels: ["EMAIL"],       description: "Weekly Monday 08:00 to admins" },
    { type: "VEHICLE_EXPIRY",        channels: ["IN_APP", "EMAIL"], description: "Rego/CTP/insurance approaching" },
  ];
  for (const a of automationTypes) {
    await prisma.notificationAutomation.upsert({
      where: { type: a.type },
      create: { type: a.type, enabled: true, channels: a.channels, description: a.description },
      update: { channels: a.channels, description: a.description },
    });
  }

  // ---------------------------------------------------------------------
  // Segments (examples)
  // ---------------------------------------------------------------------
  const segmentSeed = [
    {
      name: "Gold Coast 50-64 winback",
      description: "Customers aged 50-64 on the Gold Coast who haven't rented in 90+ days.",
      filters: {
        combinator: "AND" as const,
        filters: [
          { dimension: "AGE_RANGE" as const, min: 50, max: 64 },
          { dimension: "STATE" as const, states: ["QLD"] as ("NSW" | "VIC" | "QLD" | "SA" | "WA" | "TAS" | "ACT" | "NT")[] },
          { dimension: "LAST_RENTED_BEFORE" as const, days: 90 },
        ],
      },
    },
    {
      name: "High-spend loyalty targets",
      description: "Customers who have spent $1,000+ and opted into email marketing.",
      filters: {
        combinator: "AND" as const,
        filters: [
          { dimension: "TOTAL_SPEND_MIN" as const, amount: 1000 },
          { dimension: "MARKETING_EMAIL_OPT_IN" as const, value: true },
        ],
      },
    },
    {
      name: "Birthdays this month",
      description: "Trigger for the MARKETING_BIRTHDAY campaign.",
      filters: {
        combinator: "AND" as const,
        filters: [{ dimension: "BIRTHDAY_MONTH" as const, month: new Date().getMonth() + 1 }],
      },
    },
  ];
  for (const s of segmentSeed) {
    const existing = await prisma.segment.findFirst({ where: { name: s.name } });
    if (existing) {
      await prisma.segment.update({ where: { id: existing.id }, data: { description: s.description, filters: s.filters } });
    } else {
      await prisma.segment.create({ data: s });
    }
  }

  console.log("✅ Seed complete.");
  console.log("   Admin:    admin@xpertmoto.com.au / admin1234");
  console.log("   Manager:  manager.gold-coast@xpertmoto.com.au / staff1234");
  console.log("   Staff:    staff.gold-coast@xpertmoto.com.au / staff1234");
  console.log("   Customer: sarah.smith@example.com / customer1234");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
