// Erkennt Standardseiten (Impressum, AGB, Widerrufsbelehrung, Kontakt), die
// in jedem Exposé identisch sind und 1:1 uebernommen werden sollen.
//
// Heuristik: Diese Seiten stehen praktisch immer als "Back-Matter" am Ende.
// Sobald die erste eindeutige Rechts-/Kontaktseite beginnt (Schluesselwort +
// dichter Text ODER Position im letzten Drittel), gilt der Rest bis zum Ende
// als Standardseiten. So werden auch mehrseitige AGB komplett erfasst.

import type { BoilerplateKind } from "./types";

const KEYWORDS: { kind: BoilerplateKind; re: RegExp }[] = [
  { kind: "impressum", re: /impressum/i },
  { kind: "widerruf", re: /widerruf/i },
  { kind: "agb", re: /allgemeine gesch(ä|ae)ftsbedingungen|\bagb\b/i },
  { kind: "kontakt", re: /ansprechpartner|ihr kontakt|kontaktdaten/i },
];

export const BOILERPLATE_TITLES: Record<BoilerplateKind, string> = {
  impressum: "Impressum",
  agb: "Allgemeine Geschäftsbedingungen",
  widerruf: "Widerrufsbelehrung",
  kontakt: "Kontakt & Ansprechpartner",
};

function keywordKind(text: string): BoilerplateKind | null {
  for (const { kind, re } of KEYWORDS) if (re.test(text)) return kind;
  return null;
}

export interface PageSignal {
  text: string;
  imageCount: number;
}

// Liefert pro Seite die erkannte Standardseiten-Art (oder null = Objekt-Inhalt).
export function detectBoilerplate(pages: PageSignal[]): (BoilerplateKind | null)[] {
  const n = pages.length;
  const result: (BoilerplateKind | null)[] = new Array(n).fill(null);
  if (n === 0) return result;

  // Startseite der Back-Matter finden: erstes Schluesselwort, das entweder
  // dichten Text (>= 1200 Zeichen) hat oder im letzten Drittel liegt.
  let start = -1;
  for (let i = 0; i < n; i++) {
    const k = keywordKind(pages[i].text);
    if (!k) continue;
    const dense = pages[i].text.length >= 1200;
    const late = i >= Math.floor(n * 0.6);
    if (dense || late) {
      start = i;
      break;
    }
  }
  if (start === -1) return result;

  // Ab hier bis zum Ende: Standardseiten. Art per Schluesselwort, sonst erben.
  let current: BoilerplateKind = keywordKind(pages[start].text) ?? "impressum";
  for (let i = start; i < n; i++) {
    const k = keywordKind(pages[i].text);
    if (k) current = k;
    result[i] = current;
  }
  return result;
}
