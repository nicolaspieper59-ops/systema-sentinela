let Module = null;

importScripts('astro_engine.js');

/**
 * Calcule l'âge de la Lune et sa phase en pourcentage à partir des coordonnées Soleil/Lune.
 */
function calculerPhaseEtAgeLune(raSoleil, decSoleil, raLune, decLune) {
    const r2d = 180 / Math.PI;
    const d2r = Math.PI / 180;
    
    const raS = raSoleil * d2r;
    const decS = decSoleil * d2r;
    const raL = raLune * d2r;
    const decL = decLune * d2r;

    const cosElongation = Math.sin(decS) * Math.sin(decL) + Math.cos(decS) * Math.cos(decL) * Math.cos(raS - raL);
    const elongation = Math.acos(Math.max(-1, Math.min(1, cosElongation))) * r2d;
    
    const phasePct = 50 * (1 - Math.cos(elongation * d2r));
    const ageJours = (elongation / 360) * 29.530588;
    
    return { moonPhasePct: phasePct, moonAgeDays: ageJours };
}

/**
 * Calcule les dates exactes de la prochaine Nouvelle Lune et Pleine Lune.
 */
function calculerProchainesPhasesLune(ageActuelJours, timestampActuelMs) {
    const moisSynodique = 29.530588;
    const msParJour = 24 * 60 * 60 * 1000;

    let joursVersNouvelleLune = moisSynodique - ageActuelJours;
    if (joursVersNouvelleLune < 0) joursVersNouvelleLune += moisSynodique;

    let joursVersPleineLune = (moisSynodique / 2.0) - ageActuelJours;
    if (joursVersPleineLune < 0) joursVersPleineLune += moisSynodique;

    const tsProchaineNouvelle = timestampActuelMs + (joursVersNouvelleLune * msParJour);
    const tsProchainePleine = timestampActuelMs + (joursVersPleineLune * msParJour);

    const formaterDateIsoUTC = (ts) => {
        const d = new Date(ts);
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
    };

    return {
        nextNewMoon: formaterDateIsoUTC(tsProchaineNouvelle),
        nextFullMoon: formaterDateIsoUTC(tsProchainePleine)
    };
}

function formaterHeureDecimale(heureDec) {
    if (isNaN(heureDec)) return "--:--";
    let h = Math.floor(heureDec);
    let m = Math.floor((heureDec - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

onmessage = function(e) {
    const { type, data } = e.data;
    
    if (type === 'INIT') {
        if (typeof createAstroModule === 'function') {
            createAstroModule().then(mod => {
                Module = mod;
                postMessage({ type: 'READY' });
            });
        }
    } else if (type === 'COMPUTE') {
        if (!Module) return;
        
        const { jde, lat, lon, alt, timestamp } = data;
        const astres = ['SOLEIL', 'LUNE', 'MERCURE', 'VENUS', 'MARS', 'JUPITER', 'SATURNE', 'URANUS', 'NEPTUNE'];
        let bodiesResults = {};

        // Allocation mémoire Wasm (16 variables de type double par astre)
        const ptr = Module._malloc(16 * Float64Array.BYTES_PER_ELEMENT);

        astres.forEach((astre, index) => {
            Module._calculer_ephemerides(jde, lat, lon, alt, ptr, index);
            const baseHeapIndex = ptr / 8;
            
            const distanceAu = Module.HEAPF64[baseHeapIndex + 5];

            bodiesResults[astre] = {
                azimuth: Module.HEAPF64[baseHeapIndex + 0],
                elevationGeometrice: Module.HEAPF64[baseHeapIndex + 1],
                elevationRefractee: Module.HEAPF64[baseHeapIndex + 2],
                raDeg: Module.HEAPF64[baseHeapIndex + 3],
                decDeg: Module.HEAPF64[baseHeapIndex + 4],
                distanceAu: distanceAu,
                magnitude: -2.5,
                sunrise: formaterHeureDecimale(Module.HEAPF64[baseHeapIndex + 6]),
                sunset: formaterHeureDecimale(Module.HEAPF64[baseHeapIndex + 7]),
                airMass: Module.HEAPF64[baseHeapIndex + 8],
                irradiance: Module.HEAPF64[baseHeapIndex + 9],
                deltat: Module.HEAPF64[baseHeapIndex + 11],
                gmstDeg: Module.HEAPF64[baseHeapIndex + 12],
                gha: Module.HEAPF64[baseHeapIndex + 12],
                jde: Module.HEAPF64[baseHeapIndex + 13],
                shadowLengthDisplay: Module.HEAPF64[baseHeapIndex + 14].toFixed(2) + ' m',
                orbitVelocity: astre === 'SOLEIL' ? '0.00 km/s' : '29.78 km/s',
                constellationCode: 'AST',
                constellationNom: 'Secteur Céleste',
                constellationDisplay: 'AST (Secteur Céleste)'
            };
        });

        Module._free(ptr);

        // Calcul dynamique spécifique pour la Lune
        if (bodiesResults['SOLEIL'] && bodiesResults['LUNE']) {
            const infosLune = calculerPhaseEtAgeLune(
                bodiesResults['SOLEIL'].raDeg, bodiesResults['SOLEIL'].decDeg,
                bodiesResults['LUNE'].raDeg, bodiesResults['LUNE'].decDeg
            );
            const phases = calculerProchainesPhasesLune(infosLune.moonAgeDays, timestamp);

            bodiesResults['LUNE'].moonPhasePct = infosLune.moonPhasePct;
            bodiesResults['LUNE'].moonAgeDays = infosLune.moonAgeDays;
            bodiesResults['LUNE'].nextNewMoon = phases.nextNewMoon;
            bodiesResults['LUNE'].nextFullMoon = phases.nextFullMoon;
        }

        postMessage({ type: 'RESULTS', data: bodiesResults });
    }
};
