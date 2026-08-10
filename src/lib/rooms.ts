// Raum-Erkennung aus Bildbeschreibung und Dateiname.
//
// Wozu: im Editor sollen sich die Fotos EINES Raums per Knopf im Bild
// durchschalten lassen ("von der Küche habe ich drei Fotos"). Dafuer muss
// beim Erstellen des Exposés festgehalten werden, welche hochgeladenen Fotos
// denselben Raum zeigen. Grundlage sind die Bildbeschreibungen, welche die
// KI bei der Fotozuordnung ohnehin liefert - und zusaetzlich der Dateiname,
// der in der Praxis sehr oft den Raum nennt ("kueche_02.jpg").
//
// Bewusst ohne zusaetzliche KI-Anfrage: eine Wortliste genuegt hier, ist
// sofort nachvollziehbar und kostet nichts.

// Kanonischer Raumname -> Schreibweisen, unter denen er vorkommt.
const ROOMS: [string, string[]][] = [
  ["kueche", ["kuche", "kuechen", "kitchen", "essküche", "esskueche"]],
  ["bad", ["bad", "badezimmer", "duschbad", "wannenbad", "gaeste-wc", "gaeste wc", "gastebad", "wc"]],
  ["wohnzimmer", ["wohnzimmer", "wohnbereich", "wohnraum", "wohnen", "salon"]],
  ["esszimmer", ["esszimmer", "essbereich", "essplatz"]],
  ["schlafzimmer", ["schlafzimmer", "schlafraum", "elternschlafzimmer", "schlafen"]],
  ["kinderzimmer", ["kinderzimmer", "jugendzimmer"]],
  ["arbeitszimmer", ["arbeitszimmer", "buero", "homeoffice", "home-office", "studio"]],
  ["flur", ["flur", "diele", "eingangsbereich", "windfang", "treppenhaus", "treppe"]],
  ["hauswirtschaft", ["hauswirtschaftsraum", "hwr", "waschkueche", "abstellraum"]],
  ["keller", ["keller", "kellerraum", "untergeschoss", "souterrain"]],
  ["dach", ["dachboden", "dachgeschoss", "spitzboden", "dachstuhl"]],
  ["garage", ["garage", "carport", "stellplatz", "tiefgarage"]],
  ["terrasse", ["terrasse", "sitzplatz", "veranda"]],
  ["balkon", ["balkon", "loggia", "dachterrasse"]],
  ["garten", ["garten", "grundstueck", "aussenanlage", "hof", "gruenflaeche"]],
  ["aussen", ["aussenansicht", "fassade", "strassenansicht", "gartenseite", "hausansicht", "vorderansicht", "rueckansicht", "luftaufnahme", "drohne"]],
  ["grundriss", ["grundriss", "plan", "lageplan"]],
  ["heizung", ["heizung", "waermepumpe", "technikraum", "hausanschluss"]],
];

// Umlaute/ß vereinheitlichen und Kleinschreibung - damit "Küche", "KUECHE"
// und "kueche" gleich behandelt werden.
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/ß/g, "ss")
    .replace(/ae/g, "a")
    .replace(/oe/g, "o")
    .replace(/ue/g, "u");
}

// Liefert den Raum, den eine Beschreibung/ein Dateiname nennt - oder null,
// wenn sich keiner sicher erkennen laesst. Frueher Treffer gewinnt: die Liste
// steht bewusst vom Spezielleren zum Allgemeineren (z.B. "Dachterrasse" als
// Balkon, bevor "Terrasse" greift).
export function roomFromText(...texts: (string | undefined)[]): string | null {
  const haystack = normalize(texts.filter(Boolean).join(" "));
  if (!haystack.trim()) return null;
  for (const [room, words] of ROOMS) {
    for (const w of words) {
      if (haystack.includes(normalize(w))) return room;
    }
  }
  return null;
}

// Traegt die Alternativen an den fertigen Seiten nach - bewusst als eigener
// Schritt NACH dem Seitenbau: so bleibt er unabhaengig davon, ob die Seiten im
// uebernommenen Design oder im Luxus-Design entstanden sind.
export function attachPhotoAlternatives(
  pages: { elements: { kind: string }[] }[],
  altBySrc: Map<string, string[]>,
): void {
  for (const page of pages) {
    for (const el of page.elements) {
      if (el.kind !== "image") continue;
      const img = el as { kind: string; src?: string; altFileIds?: string[] };
      const alts = img.src ? altBySrc.get(img.src) : undefined;
      if (alts && alts.length > 1) img.altFileIds = alts;
    }
  }
}

// Ordnet jedem Foto die Datei-IDs ALLER Fotos desselben Raums zu (das eigene
// zuerst) - Grundlage fuer das Durchschalten im Editor. Fotos ohne erkannten
// Raum und Raeume mit nur einem Foto bleiben aussen vor: dort gaebe es nichts
// zu wechseln.
export function roomAlternatives(
  photos: { src: string; fileId?: string; name?: string; caption?: string }[],
): Map<string, string[]> {
  const byRoom = new Map<string, { src: string; fileId: string }[]>();
  for (const p of photos) {
    if (!p.fileId) continue;
    const room = roomFromText(p.caption, p.name);
    if (!room) continue;
    const list = byRoom.get(room);
    if (list) list.push({ src: p.src, fileId: p.fileId });
    else byRoom.set(room, [{ src: p.src, fileId: p.fileId }]);
  }
  const out = new Map<string, string[]>();
  for (const list of byRoom.values()) {
    if (list.length < 2) continue;
    for (const p of list) {
      out.set(p.src, [p.fileId, ...list.filter((o) => o.fileId !== p.fileId).map((o) => o.fileId)]);
    }
  }
  return out;
}
