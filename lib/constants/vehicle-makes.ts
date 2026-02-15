/**
 * Full list of vehicle makes (Autotrader UK–style) for the Make dropdown.
 * Merge with DB-derived makes so any custom/seed values are included.
 */
export const VEHICLE_MAKES = [
  "Abarth", "AC", "Aixam", "AK", "Alfa Romeo", "Allard", "Alpine", "Alvis",
  "Ariel", "Aston Martin", "Audi", "Austin", "BAC", "Beauford", "Bentley",
  "Blitzworld", "BMW", "Bugatti", "Buick", "BYD", "Cadillac", "Carbodies",
  "Caterham", "Changan", "Chery", "Chesil", "Chevrolet", "Chrysler", "Citroen",
  "Corbin", "Corvette", "CUPRA", "Dacia", "Daewoo", "Daihatsu", "Daimler",
  "Datsun", "David Brown", "Dax", "De Tomaso", "Dodge", "DS AUTOMOBILES",
  "E-COBRA", "Ferrari", "Fiat", "Fisker", "Ford", "Gardner Douglas", "Geely",
  "Genesis", "GMC", "Great Wall", "GWM", "Honda", "Hummer", "Hyundai", "INEOS",
  "Infiniti", "Isuzu", "JAECOO", "Jaguar", "JBA", "Jeep", "Jensen", "KGM",
  "Kia", "Koenigsegg", "Lada", "Lamborghini", "Lancia", "Land Rover", "LDV",
  "Leapmotor", "LEVC", "Lexus", "Lincoln", "Lister", "London Taxis International",
  "Lotus", "Mahindra", "Maserati", "MAXUS", "Maybach", "Mazda", "McLaren",
  "Mercedes-Benz", "MG", "Micro", "MINI", "Mitsubishi", "MOKE", "Morgan",
  "Morris", "Nissan", "Noble", "OMODA", "Opel", "Pagani", "Perodua", "Peugeot",
  "Polestar", "Porsche", "Proton", "Radical", "Ram", "RBW", "Reliant", "Renault",
  "Rolls-Royce", "Rover", "RUF", "Saab", "SEAT", "Shelby", "Skoda", "Skywell",
  "Smart", "SsangYong", "Subaru", "Suzuki", "Tesla", "Toyota", "Triumph", "TVR",
  "Ultima", "Vauxhall", "Volkswagen", "Volvo", "Westfield", "XPENG", "Zenos",
] as const;

/**
 * Returns a merged, sorted list of makes: "Any" is not included (handled in UI).
 * DB values take precedence so custom/seed data is included.
 */
export function getMakesWithDb(dbMakes: string[]): string[] {
  const set = new Set<string>([...VEHICLE_MAKES, ...dbMakes]);
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}
