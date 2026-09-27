export type FaqTextPart =
  | { kind: "text"; value: string }
  | { kind: "link"; href: string; label: string };

export interface FaqItem {
  id: string;
  question: string;
  paragraphs: FaqTextPart[][];
}

export interface FaqCategory {
  id: string;
  title: string;
  items: FaqItem[];
}
