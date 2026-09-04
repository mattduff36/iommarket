export type VehicleCategory = "car" | "van" | "motorbike" | "motorhome";

export interface VehicleTemplate {
  make: string;
  model: string;
  category: VehicleCategory;
  fuel: string;
  transmission: string;
  bodyType?: string;
  pricePounds: number;
}

export const VEHICLE_TEMPLATES: VehicleTemplate[] = [
  { make: "BMW", model: "320d M Sport", category: "car", fuel: "Diesel", transmission: "Automatic", bodyType: "Saloon", pricePounds: 24995 },
  { make: "Audi", model: "A4 35 TFSI S Line", category: "car", fuel: "Petrol", transmission: "Automatic", bodyType: "Saloon", pricePounds: 22450 },
  { make: "Volkswagen", model: "Golf 1.5 TSI Match", category: "car", fuel: "Petrol", transmission: "Manual", bodyType: "Hatchback", pricePounds: 12750 },
  { make: "Tesla", model: "Model 3 Long Range", category: "car", fuel: "Electric", transmission: "Automatic", bodyType: "Saloon", pricePounds: 33995 },
  { make: "MINI", model: "Cooper S", category: "car", fuel: "Petrol", transmission: "Manual", bodyType: "Hatchback", pricePounds: 11500 },
  { make: "Land Rover", model: "Discovery Sport HSE", category: "car", fuel: "Diesel", transmission: "Automatic", bodyType: "SUV", pricePounds: 28750 },
  { make: "Ford", model: "Fiesta 1.0 EcoBoost Zetec", category: "car", fuel: "Petrol", transmission: "Manual", bodyType: "Hatchback", pricePounds: 5995 },
  { make: "Mercedes-Benz", model: "A200 AMG Line", category: "car", fuel: "Petrol", transmission: "Automatic", bodyType: "Hatchback", pricePounds: 29995 },
  { make: "Porsche", model: "718 Cayman", category: "car", fuel: "Petrol", transmission: "Manual", bodyType: "Coupe", pricePounds: 38500 },
  { make: "Toyota", model: "Yaris Hybrid Icon", category: "car", fuel: "Petrol Hybrid", transmission: "Automatic", bodyType: "Hatchback", pricePounds: 14995 },
  { make: "Volvo", model: "XC40 T3 Momentum", category: "car", fuel: "Petrol", transmission: "Automatic", bodyType: "SUV", pricePounds: 21995 },
  { make: "Nissan", model: "Qashqai N-Connecta", category: "car", fuel: "Petrol", transmission: "Manual", bodyType: "SUV", pricePounds: 16450 },
  { make: "Kia", model: "Sportage 1.6 GDi 2", category: "car", fuel: "Petrol", transmission: "Manual", bodyType: "SUV", pricePounds: 15990 },
  { make: "Hyundai", model: "Ioniq 5 Premium", category: "car", fuel: "Electric", transmission: "Automatic", bodyType: "SUV", pricePounds: 32950 },
  { make: "Skoda", model: "Octavia SE L", category: "car", fuel: "Diesel", transmission: "Manual", bodyType: "Estate", pricePounds: 13995 },
  { make: "Peugeot", model: "208 Allure", category: "car", fuel: "Petrol", transmission: "Manual", bodyType: "Hatchback", pricePounds: 10995 },
  { make: "Vauxhall", model: "Corsa SE", category: "car", fuel: "Petrol", transmission: "Manual", bodyType: "Hatchback", pricePounds: 8750 },
  { make: "Mazda", model: "CX-5 Sport", category: "car", fuel: "Petrol", transmission: "Automatic", bodyType: "SUV", pricePounds: 18995 },
  { make: "Honda", model: "Civic Sport", category: "car", fuel: "Petrol", transmission: "Manual", bodyType: "Hatchback", pricePounds: 14250 },
  { make: "Jaguar", model: "XE R-Sport", category: "car", fuel: "Diesel", transmission: "Automatic", bodyType: "Saloon", pricePounds: 16995 },
  { make: "Ford", model: "Transit Custom 290 L2", category: "van", fuel: "Diesel", transmission: "Manual", pricePounds: 18500 },
  { make: "Mercedes-Benz", model: "Vito Tourer 111", category: "van", fuel: "Diesel", transmission: "Manual", pricePounds: 21995 },
  { make: "Volkswagen", model: "Transporter T6", category: "van", fuel: "Diesel", transmission: "Manual", pricePounds: 20450 },
  { make: "Vauxhall", model: "Vivaro Sportive", category: "van", fuel: "Diesel", transmission: "Manual", pricePounds: 15250 },
  { make: "Citroen", model: "Berlingo Enterprise", category: "van", fuel: "Diesel", transmission: "Manual", pricePounds: 11200 },
  { make: "Renault", model: "Trafic SL28", category: "van", fuel: "Diesel", transmission: "Manual", pricePounds: 13495 },
  { make: "Triumph", model: "Street Triple R", category: "motorbike", fuel: "Petrol", transmission: "Manual", pricePounds: 7250 },
  { make: "Honda", model: "CB500X", category: "motorbike", fuel: "Petrol", transmission: "Manual", pricePounds: 5495 },
  { make: "Yamaha", model: "MT-07", category: "motorbike", fuel: "Petrol", transmission: "Manual", pricePounds: 5995 },
  { make: "BMW", model: "R 1250 GS", category: "motorbike", fuel: "Petrol", transmission: "Manual", pricePounds: 12995 },
  { make: "Kawasaki", model: "Z900", category: "motorbike", fuel: "Petrol", transmission: "Manual", pricePounds: 6795 },
  { make: "Ducati", model: "Monster 821", category: "motorbike", fuel: "Petrol", transmission: "Manual", pricePounds: 8495 },
  { make: "Swift", model: "Kon-Tiki 649", category: "motorhome", fuel: "Diesel", transmission: "Manual", pricePounds: 54995 },
  { make: "Bailey", model: "Autograph 79-4T", category: "motorhome", fuel: "Diesel", transmission: "Manual", pricePounds: 47950 },
  { make: "Auto-Trail", model: "Tracker EKS", category: "motorhome", fuel: "Diesel", transmission: "Manual", pricePounds: 42995 },
  { make: "Elddis", model: "Accordo 135", category: "motorhome", fuel: "Diesel", transmission: "Manual", pricePounds: 38995 },
];

export const LISTING_IMAGES = [
  "https://images.unsplash.com/photo-1555215695-3004980ad54e?w=800&h=600&fit=crop",
  "https://images.unsplash.com/photo-1606664515524-ed2f786a0bd6?w=800&h=600&fit=crop",
  "https://images.unsplash.com/photo-1583267746897-2cf415887172?w=800&h=600&fit=crop",
  "https://images.unsplash.com/photo-1606016159991-dfe4f2746ad5?w=800&h=600&fit=crop",
  "https://images.unsplash.com/photo-1560958089-b8a1929cea89?w=800&h=600&fit=crop",
  "https://images.unsplash.com/photo-1551830820-330a71b99659?w=800&h=600&fit=crop",
  "https://images.unsplash.com/photo-1618843479313-40f8afb4b4d8?w=800&h=600&fit=crop",
  "https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=800&h=600&fit=crop",
  "https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?w=800&h=600&fit=crop",
  "https://images.unsplash.com/photo-1625047509168-a7026f36de04?w=800&h=600&fit=crop",
  "https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?w=800&h=600&fit=crop",
  "https://images.unsplash.com/photo-1558981806-ec527fa84c39?w=800&h=600&fit=crop",
  "https://images.unsplash.com/photo-1609630875171-b1321377ee65?w=800&h=600&fit=crop",
  "https://images.unsplash.com/photo-1568772585407-9361f9bf3a87?w=800&h=600&fit=crop",
] as const;

export const IOM_REGION_SLUGS = [
  "iom-north",
  "iom-south",
  "iom-east",
  "iom-west",
  "iom-central",
] as const;
