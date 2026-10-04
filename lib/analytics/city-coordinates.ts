import coordinates from "@/lib/analytics/city-coordinates.json";

/**
 * City centroids derived from the GeoNames cities15000 dataset
 * (https://www.geonames.org/), licensed CC BY 4.0.
 * Regenerate with `node scripts/build-city-coordinates.mjs` after downloading
 * countryInfo.txt and cities15000.txt from GeoNames.
 */
interface CityCoordinateFile {
  countries: Record<string, string>;
  cities: Record<string, number[]>;
}

const lookup = coordinates as CityCoordinateFile;

export interface CityCoordinate {
  latitude: number;
  longitude: number;
}

export function normalizePlaceName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function cityCoordinate(city: string, country: string): CityCoordinate | null {
  const countryCode = lookup.countries[normalizePlaceName(country)];
  const point = countryCode ? lookup.cities[`${countryCode}|${normalizePlaceName(city)}`] : undefined;
  const latitude = point?.[0];
  const longitude = point?.[1];
  if (latitude === undefined || longitude === undefined) return null;
  return { latitude, longitude };
}

export type LocatedCity<T extends { city: string; country: string }> =
  | (T & CityCoordinate & { mapped: true })
  | (T & { mapped: false });

export function locateCities<T extends { city: string; country: string }>(cities: T[]): Array<LocatedCity<T>> {
  return cities.map((city) => {
    const point = cityCoordinate(city.city, city.country);
    return point ? { ...city, ...point, mapped: true as const } : { ...city, mapped: false as const };
  });
}
