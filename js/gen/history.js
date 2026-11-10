// Historical timeline and procedural lore generator.
// Every event is tied to a real location and real nations/features in the generated world.

import { BIOMES, B } from './biomes.js';

export const EVENT_CATEGORIES = [
  { id: 'founding', label: 'Founding', color: '#e6b84c', icon: 'crown' },
  { id: 'exploration', label: 'Exploration', color: '#42b8e0', icon: 'compass' },
  { id: 'culture', label: 'Culture', color: '#b78cf2', icon: 'book' },
  { id: 'trade', label: 'Trade', color: '#46c98e', icon: 'scales' },
  { id: 'technology', label: 'Technology', color: '#61d0d4', icon: 'gear' },
  { id: 'politics', label: 'Conflict & Politics', color: '#e06458', icon: 'shield' },
  { id: 'disaster', label: 'Catastrophe', color: '#e88b42', icon: 'flame' },
  { id: 'diplomacy', label: 'Diplomacy', color: '#7fa8f5', icon: 'scroll' },
];

const TECHS = [
  { t: 0.08, title: 'Bronzeworking', desc: (c, city) => `Foundries in ${city.name} alloy copper and tin, arming the early levies of ${c.name} and revolutionizing agriculture.` },
  { t: 0.16, title: 'Codified Script', desc: (c, city) => `Clerks of ${city.name} standardize the ${c.language.name} script on clay and parchment, enabling taxation and chronicled history.` },
  { t: 0.24, title: 'Deep-Hull Navigation', desc: (c, city) => `Shipwrights at ${city.name} lay the first keeled ocean hulls, allowing ${c.demonym} mariners to sail out of sight of land.` },
  { t: 0.32, title: 'Celestial Astrolabe', desc: (c, city) => `Astronomers in ${city.name} chart the fixed stars and construct brass astrolabes, transforming navigation across ${c.name}.` },
  { t: 0.42, title: 'Blast-Furnace Steel', desc: (c, city) => `High-draft furnaces near ${city.name} smelt crucible steel in bulk, fueling both industry and warfare in ${c.name}.` },
  { t: 0.52, title: 'Movable-Type Printing', desc: (c, city) => `Workshops in ${city.name} cast movable type in ${c.language.name}, sending pamphlets and treatises along every road in ${c.name}.` },
  { t: 0.62, title: 'Optical Lenses & Cartography', desc: (c, city) => `Instrument makers of ${city.name} grind precision lenses, enabling triangulation surveys that map the borders of ${c.name}.` },
  { t: 0.72, title: 'Atmospheric Steam Engine', desc: (c, city) => `Mine pumps outside ${city.name} are fitted with coal-fired steam cylinders, inaugurating the industrial age in ${c.name}.` },
  { t: 0.81, title: 'Ironclad Railways', desc: (c, city) => `The first locomotive line links ${city.name} to the interior, halving travel times across ${c.formalName}.` },
  { t: 0.88, title: 'Optical & Wire Telegraphy', desc: (c, city) => `Copper lines strung from ${city.name} carry dispatches across ${c.name} in minutes rather than weeks.` },
  { t: 0.94, title: 'Germ Theory & Public Sanitation', desc: (c, city) => `Physicians at the college of ${city.name} isolate waterborne pathogens, prompting aqueduct reforms across ${c.name}.` },
  { t: 0.98, title: 'Wireless Spark Transmission', desc: (c, city) => `An antenna tower above ${city.name} exchanges the first wireless signals with ships offshore.` },
];

export function generateHistory(grid, world, rng, span) {
  const { W } = grid;
  const { countries, cities, features, continents, rivers, borders } = world;
  const r = rng.fork('history');
  const events = [];
  const eraOf = (y) => (y < span * 0.25 ? 'Dawn Era' : y < span * 0.55 ? 'Classical Age' : y < span * 0.8 ? 'Age of Sails & Empires' : 'Industrial Era');
  const activeAt = (y) => {
    const a = countries.filter((c) => c.founded <= y);
    return a.length ? a : countries.slice(0, 1);
  };
  const add = (e) => events.push({ id: 0, era: eraOf(e.year), ...e });

  // 1. Founding of every country
  for (const c of countries) {
    const cap = cities[c.capitalId];
    const cont = continents.find((k) => k.id === world.fields.landmass[cap.cell]);
    add({
      year: c.founded, category: 'founding', significance: 5,
      title: `Founding of ${c.name}`,
      description: `${c.ruler.title} ${c.ruler.name} unites the settlements around ${cap.name}${cont ? ` on ${cont.name}` : ''}, proclaiming the ${c.formalName} and establishing ${c.currency.name} (${c.currency.symbol}) as legal tender.`,
      x: cap.x, y: cap.y, countryIds: [c.id], cityId: cap.id,
      regionName: cont ? cont.name : c.name,
    });
  }

  // 2. Founding of major non-capital cities
  for (const city of cities) {
    if (city.type === 'capital' || city.importance < 4) continue;
    const c = countries[city.countryId];
    const why = city.type === 'port' ? 'as a deep-water anchorage and customs port' : city.type === 'industrial' ? 'around rich upland ore seams' : 'at a strategic river crossing and market crossroads';
    add({
      year: city.founded, category: 'founding', significance: 3,
      title: `Charter of ${city.name}`,
      description: `Settlers of ${c.name} establish ${city.name} ${why}; it rapidly grows into a ${city.type} hub.`,
      x: city.x, y: city.y, countryIds: [c.id], cityId: city.id, regionName: c.name,
    });
  }

  // 3. Technological ladder
  for (const tech of TECHS) {
    const year = Math.max(10, Math.round(span * tech.t + r.range(-span * 0.02, span * 0.02)));
    const pool = activeAt(year);
    const weights = pool.map((c) => (c.culture.traits.includes('Scholarly') || c.culture.traits.includes('Industrious') ? 2.5 : 1) * (tech.title.includes('Hull') && !c.coastal ? 0.1 : 1));
    const c = r.weighted(pool, weights);
    const cityPool = c.cities.map((id) => cities[id]);
    const city = tech.title.includes('Hull') ? (cityPool.find((ct) => ct.coastal) || cityPool[0]) : cityPool[0];
    add({
      year, category: 'technology', significance: 4,
      title: `Discovery of ${tech.title}`,
      description: tech.desc(c, city),
      x: city.x, y: city.y, countryIds: [c.id], cityId: city.id, regionName: c.name,
    });
  }

  // 4. Exploration of major geographical features
  const bigFeatures = [
    ...continents.slice(1).map((c) => ({ kind: 'continent', name: c.name, x: c.x, y: c.y })),
    ...features.filter((f) => ['mountain', 'desert', 'jungle', 'lake', 'ice', 'ocean'].includes(f.kind)).slice(0, 14),
    ...rivers.filter((rv) => rv.name).slice(0, 5).map((rv) => {
      const m = rv.cells[Math.floor(rv.cells.length / 2)];
      return { kind: 'river', name: rv.name, x: m % W, y: (m / W) | 0 };
    }),
  ];
  for (const f of bigFeatures) {
    const year = r.int(Math.round(span * 0.12), Math.round(span * 0.85));
    const pool = activeAt(year);
    const c = r.weighted(pool, pool.map((p) => (p.coastal || p.culture.traits.includes('Seafaring') ? 2.2 : 1)));
    const explorer = c._lang.person();
    const verb = f.kind === 'mountain' ? 'makes the first recorded crossing of' : f.kind === 'ocean' ? 'completes the first trans-oceanic voyage across' : f.kind === 'river' ? 'charts the headwaters of' : 'leads an expedition across';
    add({
      year, category: 'exploration', significance: f.kind === 'continent' || f.kind === 'ocean' ? 4 : 3,
      title: `Expedition to ${f.name}`,
      description: `Navigator ${explorer}, sailing under the banner of ${c.name}, ${verb} ${f.name}, returning with botanical specimens and survey charts.`,
      x: f.x, y: f.y, countryIds: [c.id], regionName: f.name,
    });
  }

  // 5. Cultural movements
  const culturalCount = Math.min(20, countries.length * 2);
  for (let k = 0; k < culturalCount; k++) {
    const year = r.int(Math.round(span * 0.1), Math.round(span * 0.96));
    const c = r.pick(activeAt(year));
    const city = cities[r.pick(c.cities)];
    const work = c._lang.root();
    const kind = r.pick(['renaissance', 'epic', 'faith', 'academy', 'architecture']);
    const map = {
      renaissance: [`The ${city.name} Renaissance`, `Patron guilds in ${city.name} fund painters, polymaths and playwrights, defining the classic ${c.demonym} aesthetic.`],
      epic: [`Composition of the "${work}iad"`, `Poet-chroniclers in ${city.name} set down the national epic of ${c.name} in verse, recited at every ${c.culture.festival}.`],
      faith: [`Synod of ${city.name}`, `Scholars and Prelates gather in ${city.name} to codify the canons of the ${c.culture.religion}.`],
      academy: [`Grand Academy of ${city.name}`, `${c.ruler.title} ${c._lang.person()} charters a collegium in ${city.name}, drawing natural philosophers from across ${c.name}.`],
      architecture: [`Raising of the Great Spire of ${city.name}`, `Master masons complete a monumental sanctuary in ${city.name}, quarantine-cut from local stone and visible for leagues.`],
    }[kind];
    add({ year, category: 'culture', significance: 3, title: map[0], description: map[1], x: city.x, y: city.y, countryIds: [c.id], cityId: city.id, regionName: c.name });
  }

  // 6. Trade expansion
  const ports = cities.filter((ct) => ct.coastal);
  const tradeCount = Math.min(16, Math.max(6, countries.length));
  for (let k = 0; k < tradeCount; k++) {
    const year = r.int(Math.round(span * 0.18), Math.round(span * 0.95));
    const active = activeAt(year);
    if (active.length < 2) continue;
    const a = r.pick(active), b = r.pick(active.filter((x) => x.id !== a.id));
    const ca = cities[a.capitalId], cb = cities[b.capitalId];
    const sea = a.coastal && b.coastal && ports.length >= 2 && r.chance(0.6);
    const goods = r.pick(['silk and astronomical brass', 'salt, timber and amber', 'porcelain, spices and dye-woods', 'grain, wool and quenched steel', 'tea, glasswork and sulfur', 'silver bullion and manuscripts']);
    add({
      year, category: 'trade', significance: 3,
      title: sea ? `The ${a.name}–${b.name} Maritime Route` : `The ${ca.name}–${cb.name} Caravan Road`,
      description: `Merchant houses of ${a.name} and ${b.name} open a protected ${sea ? 'sea lane' : 'overland corridor'} between ${ca.name} and ${cb.name}, trading ${goods} settled in ${a.currency.name}s.`,
      x: ca.x, y: ca.y, x2: cb.x, y2: cb.y, countryIds: [a.id, b.id], cityId: ca.id, regionName: `${a.name}–${b.name}`,
    });
  }

  // 7. Border conflicts, political reforms & diplomacy
  const pairs = borders.length ? borders : countries.length >= 2 ? [{ a: 0, b: 1, cell: countries[0].capitalCell }] : [];
  const conflictCount = Math.min(22, Math.max(6, pairs.length * 2));
  for (let k = 0; k < conflictCount && pairs.length; k++) {
    const p = r.pick(pairs);
    const A = countries[p.a], B = countries[p.b];
    const minY = Math.max(A.founded, B.founded) + 15;
    if (minY >= span - 20) continue;
    const year = r.int(minY, span - 15);
    const bx = p.cell % W, by = (p.cell / W) | 0;
    const warName = r.pick([`War of the ${A._lang.root()} Marches`, `The ${A.name}–${B.name} Border War`, `War of the ${r.pick(['Three Rivers', 'Salt Tolls', 'Succession', 'High Passes', 'Silver Straits'])}`]);
    add({
      year, category: 'politics', significance: 4,
      title: warName,
      description: `Disputes over customs and frontier garrisons ignite armed conflict between ${A.formalName} and ${B.formalName} along their shared march.`,
      x: bx, y: by, countryIds: [A.id, B.id], regionName: `${A.name}–${B.name} Frontier`,
    });
    // Peace treaty a few years later
    if (r.chance(0.75)) {
      const peaceY = Math.min(span - 1, year + r.int(2, 14));
      const hostCity = cities[r.pick([A.capitalId, B.capitalId])];
      add({
        year: peaceY, category: 'diplomacy', significance: 4,
        title: `Treaty of ${hostCity.name}`,
        description: `Envoys of ${A.name} and ${B.name} sign a concordat at ${hostCity.name}, fixing boundary stones and guaranteeing mutual trade privileges.`,
        x: hostCity.x, y: hostCity.y, countryIds: [A.id, B.id], cityId: hostCity.id, regionName: hostCity.name,
      });
    }
  }
  // Internal political reforms
  for (const c of countries) {
    if (!r.chance(0.75)) continue;
    const year = r.int(Math.min(span - 5, c.founded + 40), span - 2);
    const cap = cities[c.capitalId];
    const kind = r.pick(['charter', 'reform', 'unification']);
    const text = {
      charter: [`Great Charter of ${cap.name}`, `Nobles and burghers of ${c.name} compel the crown at ${cap.name} to ratify a constitutional charter limiting arbitrary levies.`],
      reform: [`The ${c._lang.root()} Edicts`, `Sweeping administrative reforms in ${c.formalName} standardize weights, measures, road tolls and provincial courts.`],
      unification: [`Concord of ${c.name}`, `Autonomous provinces of ${c.name} swear a perpetual articles of union in ${cap.name}, cementing the modern ${c.government.toLowerCase()}.`],
    }[kind];
    add({ year, category: 'politics', significance: 4, title: text[0], description: text[1], x: cap.x, y: cap.y, countryIds: [c.id], cityId: cap.id, regionName: c.name });
  }
  // Multilateral alliances
  for (let k = 0; k < 5 && countries.length >= 3; k++) {
    const year = r.int(Math.round(span * 0.35), span - 5);
    const pool = activeAt(year);
    if (pool.length < 2) continue;
    const a = r.pick(pool), b = r.pick(pool.filter((x) => x.id !== a.id));
    const host = cities[a.capitalId];
    add({
      year, category: 'diplomacy', significance: 3,
      title: `League of ${host.name}`,
      description: `${a.name} and ${b.name} conclude a defensive and navigation pact at ${host.name}, opening ports to each other's merchant fleets.`,
      x: host.x, y: host.y, countryIds: [a.id, b.id], cityId: host.id, regionName: host.name,
    });
  }

  // 8. Natural disasters anchored to real terrain
  const mtnFeatures = features.filter((f) => f.kind === 'mountain');
  const disasterCount = 12;
  for (let k = 0; k < disasterCount; k++) {
    const year = r.int(30, span - 5);
    const kind = r.weighted(['eruption', 'quake', 'flood', 'drought', 'tsunami'], [mtnFeatures.length ? 2 : 0, mtnFeatures.length ? 2 : 1, 2, 1.5, ports.length ? 2 : 0]);
    if (kind === 'eruption' && mtnFeatures.length) {
      const m = r.pick(mtnFeatures);
      add({
        year, category: 'disaster', significance: 5,
        title: `Eruption of ${m.peak.name}`,
        description: `${m.peak.name} in the ${m.name} erupts in a towering ash column, dimming sunsets across the hemisphere and fertile-blanketing the surrounding valleys.`,
        x: m.peak.x, y: m.peak.y, countryIds: [], regionName: m.name,
      });
    } else if (kind === 'tsunami' && ports.length) {
      const ct = r.pick(ports);
      const c = countries[ct.countryId];
      add({
        year, category: 'disaster', significance: 4,
        title: `Great Tide of ${ct.name}`,
        description: `A submarine trench slip sends a wall of water into the harbour of ${ct.name}; ${c.name} rebuilds the port behind monumental basalt seawalls.`,
        x: ct.x, y: ct.y, countryIds: [c.id], cityId: ct.id, regionName: ct.name,
      });
    } else {
      const ct = r.pick(cities);
      const c = countries[ct.countryId];
      const map = {
        quake: [`The ${ct.name} Earthquake`, `A severe tremor fractures masonry across ${ct.name}, prompting ${c.demonym} builders to adopt timber-laced stone frames.`],
        flood: [`Hundred-Year Flood of ${ct.name}`, `Unseasonable snowmelt and monsoon rains swell the rivers around ${ct.name}, leading ${c.name} to construct stepped levees and flood canals.`],
        drought: [`The Seven Dry Summers of ${c.name}`, `Persistent high-pressure ridges parch the farmlands around ${ct.name}; state granaries and terrace cisterns are established across ${c.name}.`],
      }[kind] || [`Great Frost of ${ct.name}`, `Bitter polar winds freeze the rivers at ${ct.name}.`];
      add({ year, category: 'disaster', significance: 3, title: map[0], description: map[1], x: ct.x, y: ct.y, countryIds: [c.id], cityId: ct.id, regionName: c.name });
    }
  }

  events.sort((a, b) => a.year - b.year || b.significance - a.significance);
  events.forEach((e, i) => { e.id = i; });
  return events;
}

const ARCH_BY_BIOME = {
  [B.DESERT]: 'wind-carved sandstone courtyard houses with shaded arcades, mashrabiya lattices and subterranean qanat cisterns',
  [B.SAVANNA]: 'sun-baked rammed-earth citadels, terraced adobe granaries and wide colonnaded market plazas',
  [B.RAINFOREST]: 'stepped basalt causeways, steep-gabled cedar halls raised on carved stone plinths, and canal-lined temple precincts',
  [B.TROPICAL_FOREST]: 'teak-and-laterite pavilions with tiered roofs, reflecting pools and carved monsoon drainage galleries',
  [B.TEMPERATE_FOREST]: 'half-timbered guildhalls, dressed-limestone cathedrals and slate-roofed river embankments',
  [B.TEMPERATE_RAINFOREST]: 'heavy cedar post-and-beam longhouses, moss-gardened cloisters and copper-sheathed towers',
  [B.GRASSLAND]: 'broad brick basilicas, vaulted grain exchanges, star-bastioned ramparts and cobbled post-roads',
  [B.SHRUBLAND]: 'whitewashed hillside villas, terracotta-tiled loggias and dry-stone olive terraces',
  [B.TAIGA]: 'steep-pitched pine stave halls, onion-domed citadels and deep hearth-warmed stone cellars',
  [B.TUNDRA]: 'low turf-insulated stone keeps, whale-ribbed halls and geothermal bathhouses',
  [B.ALPINE]: 'cantilevered granite monasteries, slate watchtowers and arched viaducts spanning mountain gorges',
  [B.VOLCANIC]: 'cyclopean black-basalt fortresses, obsidian-inlaid sanctuaries and geothermal steam-heated galleries',
};

const CUISINE_BY_BIOME = {
  [B.DESERT]: 'dates, flatbreads baked on hot stones, spiced mutton and mint infusions',
  [B.SAVANNA]: 'millet porridges, smoked game, tamarind stews and fermented honey beer',
  [B.RAINFOREST]: 'steamed river fish in aromatic leaves, cassava cakes, cacao and peppered fruit',
  [B.TROPICAL_FOREST]: 'fragrant rice, coconut curries, roasted plantains and palm wine',
  [B.TEMPERATE_FOREST]: 'rye loaves, orchard ciders, smoked venison and root-cellar cheeses',
  [B.GRASSLAND]: 'hearth-baked wheat bread, roasted lamb, aged mare’s-milk cheese and barley ale',
  [B.SHRUBLAND]: 'olive oil, grilled sea bream, herb flatbreads and resinous hill wines',
  [B.TAIGA]: 'cured salmon, buckwheat blini, cloudberry preserves and birch-smoked game',
  [B.TUNDRA]: 'air-dried char, seal-oil stews, lichen flatbreads and hot spicedberry broth',
  [B.VOLCANIC]: 'fumarole-smoked meats, mineral-rich root stews, ash-crust breads and spiced sulfur-spring wines',
};

export function generateLore(grid, world, rng) {
  const { countries, cities, continents, features, history } = world;
  for (const c of countries) {
    const r = c._rng.fork('lore');
    const cap = cities[c.capitalId];
    const dom = c.dominantBiomes[0] ?? B.GRASSLAND;
    const bName = BIOMES[dom].name.toLowerCase();
    const arch = ARCH_BY_BIOME[dom] || ARCH_BY_BIOME[B.GRASSLAND];
    const food = CUISINE_BY_BIOME[dom] || CUISINE_BY_BIOME[B.GRASSLAND];
    const neighborNames = c.neighbors.slice(0, 3).map((id) => countries[id].name);
    const rels = neighborNames.length ? `It shares borders with ${neighborNames.join(', ')}` : 'Occupying an insular realm without land borders';
    const notableEvents = history.filter((e) => e.countryIds.includes(c.id) && e.significance >= 4).slice(0, 3);
    c.lore = {
      overview: `The ${c.formalName} is a ${c.government.toLowerCase()} founded in Year ${c.founded} around its capital at ${cap.name}. Spanning ${Math.round(c.area).toLocaleString()} km² of predominantly ${bName} terrain, it is home to ${c.population.toLocaleString()} citizens who speak ${c.language.name} and trade in the ${c.currency.name} (${c.currency.symbol}).`,
      culture: `${c.demonym} society is widely regarded as ${c.culture.traits.map((t) => t.toLowerCase()).join(', ')}. Religious life centers on the ${c.culture.religion}, culminating each year in the ${c.culture.festival}. Everyday tables favour ${food}${c.coastal ? ', supplemented by abundant coastal catches' : ''}.`,
      architecture: `Urban centres—foremost among them ${c.cities.slice(0, 3).map((id) => cities[id].name).join(', ')}—are characterized by ${arch}. Public monuments bear the national motto, "${c.motto}" ("${c.mottoMeaning}").`,
      geopolitics: `${rels}, and is governed by ${c.ruler.title} ${c.ruler.name}. ${notableEvents.length ? 'Key turning points include ' + notableEvents.map((e) => `${e.title} (Y${e.year})`).join(', ') + '.' : ''}`,
    };
  }
  for (const cont of continents) {
    const topBiomes = Object.entries(cont.biomeArea).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([b]) => BIOMES[+b].name.toLowerCase());
    const nations = countries.filter((c) => world.fields.landmass[c.capitalCell] === cont.id).map((c) => c.name);
    cont.lore = `${cont.name} is a landmass of ${Math.round(cont.area).toLocaleString()} km² (${((cont.area / grid.totalArea) * 100).toFixed(1)}% of the planet's surface), dominated by ${topBiomes.join(', ')} landscapes.${cont.highest ? ` Its highest summit is ${cont.highest.name} at ${cont.highest.elevation.toLocaleString()} m.` : ''}${nations.length ? ` It is the seat of ${nations.join(', ')}.` : ' Its interior remains largely unclaimed by major states.'}`;
  }
  for (const f of features) {
    if (f.kind === 'mountain') f.lore = `A major tectonic cordillera covering ${Math.round(f.area).toLocaleString()} km², crowned by ${f.peak.name} (${f.peak.elevation.toLocaleString()} m).`;
    else if (f.kind === 'lake') f.lore = `An inland freshwater basin spanning ${Math.round(f.area).toLocaleString()} km², fed by surrounding upland catchments.`;
    else if (f.kind === 'ocean' || f.kind === 'sea') f.lore = `A major marine basin covering ${Math.round(f.area).toLocaleString()} km², traversed by planetary wind-driven gyres.`;
    else f.lore = `A vast ${f.kind} ecoregion extending across ${Math.round(f.area).toLocaleString()} km².`;
  }
  // world summary paragraph
  const topNations = countries.slice().sort((a, b) => b.population - a.population).slice(0, 3).map((c) => c.formalName);
  const bigCont = continents[0];
  world.lore = {
    summary: `${world.name} is a ${world.settings.size}-class terrestrial world of radius ${grid.R.toLocaleString()} km, with ${((1 - world.stats.landFraction) * 100).toFixed(1)}% of its surface covered by oceans and ${continents.length} major continent${continents.length === 1 ? '' : 's'} led by ${bigCont ? bigCont.name : 'its primary landmass'}. Across ${world.settings.historySpan.toLocaleString()} years of recorded history, ${countries.length} sovereign civilizations and ${cities.length} cities have risen, with ${topNations.join(', ')} standing as the most populous powers of the present age.`,
  };
}

