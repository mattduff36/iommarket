import { createReadStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { resolve } from "node:path";

const countryAliases = {
  "united states of america": "US",
  "usa": "US",
  "uk": "GB",
  "great britain": "GB",
  "czech republic": "CZ",
  "russian federation": "RU",
  "republic of korea": "KR",
  "korea republic of": "KR",
  "korea democratic people s republic of": "KP",
  "viet nam": "VN",
  "cote d ivoire": "CI",
  "ivory coast": "CI",
  "burma": "MM",
  "swaziland": "SZ",
  "macedonia": "MK",
  "east timor": "TL",
  "cape verde": "CV",
  "palestine": "PS",
  "state of palestine": "PS",
  "palestinian territories": "PS",
  "macau": "MO",
  "macao sar china": "MO",
  "hong kong sar china": "HK",
  "syria arab republic": "SY",
  "syrian arab republic": "SY",
  "iran islamic republic of": "IR",
  "laos people s democratic republic": "LA",
  "lao people s democratic republic": "LA",
  "moldova republic of": "MD",
  "tanzania united republic of": "TZ",
  "bolivia plurinational state of": "BO",
  "venezuela bolivarian republic of": "VE",
  "brunei darussalam": "BN",
  "dr congo": "CD",
  "congo kinshasa": "CD",
  "congo brazzaville": "CG",
  "turkiye": "TR",
  "turkey": "TR",
};

function normalizePlace(value) {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function latinAlternate(value) {
  if (!/^[A-Za-z][A-Za-z .'-]{2,48}$/.test(value)) return "";
  if (value === value.toUpperCase() && value.length <= 4) return "";
  const normalized = normalizePlace(value);
  return normalized.length >= 4 ? normalized : "";
}

async function countryNames(path) {
  const countries = {};
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line || line.startsWith("#")) continue;
    const [code, , , , name] = line.split("\t");
    if (!code || !name || code.length !== 2) continue;
    const normalized = normalizePlace(name);
    countries[normalized] = code;
    const withoutThe = normalized.replace(/^the /, "");
    if (withoutThe !== normalized && !countries[withoutThe]) countries[withoutThe] = code;
  }
  return { ...countries, ...countryAliases };
}

async function cityPoints(path) {
  const points = new Map();
  const pendingAlternates = [];
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of lines) {
    const columns = line.split("\t");
    const country = columns[8];
    const latitude = Number(columns[4]);
    const longitude = Number(columns[5]);
    const parsedPopulation = Number(columns[14] ?? 0);
    const population = Number.isFinite(parsedPopulation) ? parsedPopulation : 0;
    if (!country || country.length !== 2 || !Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    const names = new Set([normalizePlace(columns[1] ?? ""), normalizePlace(columns[2] ?? "")].filter(Boolean));
    for (const name of names) points.set(`${country}|${name}`, choose(points.get(`${country}|${name}`), latitude, longitude, population));
    if (population < 500_000) continue;
    for (const alternate of (columns[3] ?? "").split(",")) {
      const name = latinAlternate(alternate);
      if (name && !names.has(name)) pendingAlternates.push([`${country}|${name}`, latitude, longitude, population]);
    }
  }
  for (const [key, latitude, longitude, population] of pendingAlternates) {
    points.set(key, choose(points.get(key), latitude, longitude, population));
  }
  return points;
}

function choose(existing, latitude, longitude, population) {
  if (existing && existing.population >= population) return existing;
  return {
    latitude: Math.round(latitude * 10_000) / 10_000,
    longitude: Math.round(longitude * 10_000) / 10_000,
    population,
  };
}

const countries = await countryNames(process.argv[2] ?? "/tmp/countryInfo.txt");
const points = await cityPoints(process.argv[3] ?? "/tmp/cities15000.txt");
const cities = {};
for (const [key, point] of points) cities[key] = [point.latitude, point.longitude];
const output = resolve("lib/analytics/city-coordinates.json");
await writeFile(output, JSON.stringify({ countries, cities }));
console.log(`countries ${Object.keys(countries).length}, cities ${Object.keys(cities).length}`);
