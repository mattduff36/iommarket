export interface AttributeDef {
  id: string;
  name: string;
  slug: string;
  dataType: string;
  required: boolean;
  options: string | null;
}

export interface CategoryOption {
  id: string;
  name: string;
  slug: string;
  attributes: AttributeDef[];
}

export interface RegionOption {
  id: string;
  name: string;
}

