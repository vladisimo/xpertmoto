import { logger } from "@/lib/logger";

export type DailyWeather = {
  date: string;
  tempMaxC: number;
  tempMinC: number;
  precipitationMm: number;
  precipitationProbability: number;
  weatherCode: number;
  summary: string;
};

export type WeatherForecast = {
  latitude: number;
  longitude: number;
  timezone: string;
  daily: DailyWeather[];
};

const WMO_SUMMARIES: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Freezing fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Heavy drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  80: "Light showers",
  81: "Showers",
  82: "Heavy showers",
  95: "Thunderstorm",
  96: "Thunderstorm with hail",
  99: "Severe thunderstorm",
};

export function summariseWeatherCode(code: number): string {
  return WMO_SUMMARIES[code] ?? "Unknown";
}

/**
 * Returns true when riding conditions are unsafe / highly discouraged:
 * heavy rain, thunderstorms, snow, or precipitation probability > 70%.
 */
export function isRidingUnsafe(day: DailyWeather): boolean {
  if ([65, 75, 82, 95, 96, 99].includes(day.weatherCode)) return true;
  if (day.precipitationProbability >= 70) return true;
  return false;
}

/**
 * 7-day forecast from Open-Meteo. Free, no API key.
 */
export async function getForecast(
  latitude: number,
  longitude: number,
  options: { days?: number; timezone?: string } = {},
): Promise<WeatherForecast | null> {
  const days = options.days ?? 7;
  const tz = options.timezone ?? "Australia/Sydney";
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", latitude.toString());
  url.searchParams.set("longitude", longitude.toString());
  url.searchParams.set(
    "daily",
    "temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,weather_code",
  );
  url.searchParams.set("forecast_days", days.toString());
  url.searchParams.set("timezone", tz);

  try {
    const res = await fetch(url.toString(), { next: { revalidate: 1800 } });
    if (!res.ok) {
      logger.warn({ status: res.status, url: url.toString() }, "weather fetch failed");
      return null;
    }
    const data = (await res.json()) as {
      latitude: number;
      longitude: number;
      timezone: string;
      daily: {
        time: string[];
        temperature_2m_max: number[];
        temperature_2m_min: number[];
        precipitation_sum: number[];
        precipitation_probability_max: number[];
        weather_code: number[];
      };
    };

    const daily: DailyWeather[] = data.daily.time.map((date, i) => {
      const code = data.daily.weather_code[i] ?? 0;
      return {
        date,
        tempMaxC: data.daily.temperature_2m_max[i] ?? 0,
        tempMinC: data.daily.temperature_2m_min[i] ?? 0,
        precipitationMm: data.daily.precipitation_sum[i] ?? 0,
        precipitationProbability: data.daily.precipitation_probability_max[i] ?? 0,
        weatherCode: code,
        summary: summariseWeatherCode(code),
      };
    });

    return {
      latitude: data.latitude,
      longitude: data.longitude,
      timezone: data.timezone,
      daily,
    };
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "weather fetch errored");
    return null;
  }
}
