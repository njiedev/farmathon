import { z } from "zod";

import type { Tool } from "./tool.js";

export const weatherInputSchema = z.object({ location: z.string().min(2) }).strict();
export type WeatherInput = z.infer<typeof weatherInputSchema>;

export interface WeatherOutput {
  location: string;
  current: { temperatureF: number; humidity: number; windMph: number; weatherCode: number };
  daily: Array<{
    date: string;
    highF: number;
    lowF: number;
    precipitationChance: number;
    precipitationInches: number;
  }>;
  alerts: string[];
  source: "Open-Meteo";
}

interface GeocodingResult { name: string; admin1?: string; latitude: number; longitude: number }
interface GeocodingResponse { results?: GeocodingResult[] }

interface ForecastResponse {
  current: { temperature_2m: number; relative_humidity_2m: number; wind_speed_10m: number; weather_code: number };
  daily: {
    time: string[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_probability_max: number[];
    precipitation_sum: number[];
  };
}

export function createWeatherTool(fetchImpl: typeof fetch = fetch): Tool<WeatherInput, WeatherOutput> {
  return {
    name: "get_weather",
    description: "Get current conditions, a five-day farm forecast, and weather risk alerts.",
    inputSchema: weatherInputSchema,
    async execute({ location }) {
      let match: GeocodingResult | undefined;
      const queries = [...new Set([location, location.split(",")[0]?.trim()].filter((value): value is string => Boolean(value)))];
      for (const query of queries) {
        const geocodeUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
        geocodeUrl.searchParams.set("name", query);
        geocodeUrl.searchParams.set("count", "1");
        geocodeUrl.searchParams.set("language", "en");
        const geocodeResponse = await fetchImpl(geocodeUrl);
        if (!geocodeResponse.ok) throw new Error(`Geocoding failed: ${geocodeResponse.status}`);
        const geocoding = (await geocodeResponse.json()) as GeocodingResponse;
        match = geocoding.results?.[0];
        if (match !== undefined) break;
      }
      if (match === undefined) throw new Error(`Location not found: ${location}`);

      const forecastUrl = new URL("https://api.open-meteo.com/v1/forecast");
      forecastUrl.searchParams.set("latitude", String(match.latitude));
      forecastUrl.searchParams.set("longitude", String(match.longitude));
      forecastUrl.searchParams.set("temperature_unit", "fahrenheit");
      forecastUrl.searchParams.set("wind_speed_unit", "mph");
      forecastUrl.searchParams.set("precipitation_unit", "inch");
      forecastUrl.searchParams.set("timezone", "auto");
      forecastUrl.searchParams.set("forecast_days", "5");
      forecastUrl.searchParams.set("current", "temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code");
      forecastUrl.searchParams.set("daily", "temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum");
      const forecastResponse = await fetchImpl(forecastUrl);
      if (!forecastResponse.ok) throw new Error(`Forecast failed: ${forecastResponse.status}`);
      const forecast = (await forecastResponse.json()) as ForecastResponse;
      const daily = forecast.daily.time.map((date, index) => ({
        date,
        highF: forecast.daily.temperature_2m_max[index] ?? 0,
        lowF: forecast.daily.temperature_2m_min[index] ?? 0,
        precipitationChance: forecast.daily.precipitation_probability_max[index] ?? 0,
        precipitationInches: forecast.daily.precipitation_sum[index] ?? 0
      }));
      const alerts: string[] = [];
      if (daily.some((day) => day.lowF <= 36)) alerts.push("Cold-night risk: forecast lows approach frost range.");
      if (daily.some((day) => day.precipitationChance >= 70 || day.precipitationInches >= 0.75)) alerts.push("Heavy rain window: review field access and spray timing.");
      if (daily.every((day) => day.precipitationInches < 0.05)) alerts.push("Dry five-day outlook: monitor soil moisture and irrigation needs.");
      return {
        location: [match.name, match.admin1].filter(Boolean).join(", "),
        current: {
          temperatureF: forecast.current.temperature_2m,
          humidity: forecast.current.relative_humidity_2m,
          windMph: forecast.current.wind_speed_10m,
          weatherCode: forecast.current.weather_code
        },
        daily,
        alerts,
        source: "Open-Meteo"
      };
    }
  };
}

export const weatherTool = createWeatherTool();
