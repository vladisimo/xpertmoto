import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getForecast, isRidingUnsafe } from "@/lib/weather";
import { PublicDepotMap } from "@/components/maps/public-depot-map";

export default async function LocationsPage() {
  const depots = await prisma.depot.findMany({
    where: { isActive: true, deletedAt: null },
    orderBy: { name: "asc" },
    include: { _count: { select: { vehicles: { where: { status: "AVAILABLE" } } } } },
  });

  const mapPins = depots
    .filter((d) => d.latitude != null && d.longitude != null)
    .map((d) => ({
      id: d.id,
      name: d.name,
      lat: d.latitude as number,
      lng: d.longitude as number,
      addressLine1: d.addressLine1,
      suburb: d.suburb,
      state: d.state,
      postcode: d.postcode,
      phone: d.phone,
      availableVehicles: d._count.vehicles,
    }));

  const forecasts = await Promise.all(
    depots.map(async (d) =>
      d.latitude != null && d.longitude != null
        ? {
            depotId: d.id,
            forecast: await getForecast(d.latitude, d.longitude, { days: 3, timezone: d.timezone }),
          }
        : { depotId: d.id, forecast: null },
    ),
  );
  const forecastByDepot = new Map(forecasts.map((f) => [f.depotId, f.forecast]));

  return (
    <div className="container py-12">
      <h1 className="h-display">Locations</h1>
      <p className="mt-2 text-muted-foreground">Hire from any of our three Australian depots.</p>

      {mapPins.length > 0 && (
        <div className="mt-8 h-[420px] overflow-hidden rounded-lg border">
          <PublicDepotMap depots={mapPins} zoom={mapPins.length === 1 ? 17 : undefined} />
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-3 mt-10">
        {depots.map((d) => {
          const forecast = forecastByDepot.get(d.id);
          return (
            <Card key={d.id}>
              <CardHeader>
                <CardTitle>{d.name}</CardTitle>
                <CardDescription>
                  {d.addressLine1}, {d.suburb} {d.state} {d.postcode}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div>📞 {d.phone}</div>
                <div>✉️ {d.email}</div>
                <div>🕐 Mon–Sun 8:00–18:00</div>
                <div className="text-muted-foreground">{d._count.vehicles} rides available</div>
                {forecast && forecast.daily.length > 0 && (
                  <div className="mt-3 rounded-md bg-muted/50 p-2 text-xs">
                    <div className="font-semibold mb-1">3-day forecast</div>
                    <div className="grid grid-cols-3 gap-1">
                      {forecast.daily.slice(0, 3).map((day) => {
                        const unsafe = isRidingUnsafe(day);
                        return (
                          <div
                            key={day.date}
                            className={`rounded p-1 text-center ${unsafe ? "bg-destructive/10 text-destructive" : ""}`}
                          >
                            <div className="font-medium">
                              {new Date(day.date).toLocaleDateString("en-AU", { weekday: "short" })}
                            </div>
                            <div>
                              {Math.round(day.tempMinC)}–{Math.round(day.tempMaxC)}°
                            </div>
                            <div className="truncate">{day.summary}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                <Button asChild className="w-full mt-4">
                  <Link href={`/booking?depotId=${d.id}`}>Book from here</Link>
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
