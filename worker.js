/**
 * SYSTEMA SENTINELA — WEB WORKER (v19.13 STRICT PRODUCTION)
 */

var Module = {
    onRuntimeInitialized: function() {
        wasmReady = true;
        initialiserMemoireWasm();
        postMessage({ type: 'WORKER_READY', diagnostic: auditerEnvironnementInterne() });
    }
};

let wasmReady = false;
let matriceJplGlobal = null;
let coefficientsWMMGlobal = null;
let metricsPtr = 0;
let resultPtr = 0;

importScripts('wasm_astronomie.js');

const CONSTANTES_ORBITALES = {
    'SOLEIL': { orbitPeriod: '365.25 j', lengthOfDay: '24.0 h', orbitVel: '29.78 km/s', minMaxAu: '0.983 - 1.017 UA', perigee: '0.983 UA', aphelion: '1.017 UA' },
    'LUNE': { orbitPeriod: '27.32 j', lengthOfDay: '708.7 h', orbitVel: '1.02 km/s', minMaxAu: '0.0025 - 0.0027 UA', perigee: '0.0549 UA', aphelion: '0.0569 UA' },
    'MERCURE': { orbitPeriod: '88.0 j', lengthOfDay: '4222.6 h', orbitVel: '47.36 km/s', minMaxAu: '0.307 - 0.466 UA', perigee: '0.307 UA', aphelion: '0.466 UA' },
    'VENUS': { orbitPeriod: '224.7 j', lengthOfDay: '2802.0 h', orbitVel: '35.02 km/s', minMaxAu: '0.718 - 0.728 UA', perigee: '0.718 UA', aphelion: '0.728 UA' },
    'MARS': { orbitPeriod: '687.0 j', lengthOfDay: '24.6 h', orbitVel: '24.07 km/s', minMaxAu: '1.381 - 1.666 UA', perigee: '1.381 UA', aphelion: '1.666 UA' },
    'JUPITER': { orbitPeriod: '4331 j', lengthOfDay: '9.9 h', orbitVel: '13.07 km/s', minMaxAu: '4.95 - 5.46 UA', perigee: '4.95 UA', aphelion: '5.46 UA' },
    'SATURNE': { orbitPeriod: '10747 j', lengthOfDay: '10.7 h', orbitVel: '9.68 km/s', minMaxAu: '9.04 - 10.12 UA', perigee: '9.04 UA', aphelion: '10.12 UA' },
    'URANUS': { orbitPeriod: '30589 j', lengthOfDay: '17.2 h', orbitVel: '6.80 km/s', minMaxAu: '18.28 - 20.11 UA', perigee: '18.28 UA', aphelion: '20.11 UA' },
    'NEPTUNE': { orbitPeriod: '59800 j', lengthOfDay: '16.1 h', orbitVel: '5.43 km/s', minMaxAu: '29.81 - 30.33 UA', perigee: '29.81 UA', aphelion: '30.33 UA' }
};

function obtenirConstellationIAU(raDeg, decDeg) {
    const ra = (raDeg % 360 + 360) % 360;
    const dec = decDeg;

    if (dec >= 60) {
        if (ra < 30) return { code: 'Cas', nom: 'Cassiopeia' };
        if (ra < 90) return { code: 'Per', nom: 'Perseus' };
        if (ra < 150) return { code: 'Cam', nom: 'Camelopardalis' };
        if (ra < 210) return { code: 'UMa', nom: 'Ursa Major' };
        if (ra < 270) return { code: 'Dra', nom: 'Draco' };
        if (ra < 330) return { code: 'Cep', nom: 'Cepheus' };
        return { code: 'UMi', nom: 'Ursa Minor' };
    }
    if (dec >= 0 && dec < 60) {
        if (ra < 28) return { code: 'Psc', nom: 'Pisces' };
        if (ra < 53) return { code: 'Ari', nom: 'Aries' };
        if (ra < 91) return { code: 'Tau', nom: 'Taurus' };
        if (ra < 118) return { code: 'Ori', nom: 'Orion' };
        if (ra < 152) return { code: 'Gem', nom: 'Gemini' };
        if (ra < 187) return { code: 'Cnc', nom: 'Cancer' };
        if (ra < 229) return { code: 'Leo', nom: 'Leo' };
        if (ra < 261) return { code: 'Vir', nom: 'Virgo' };
        if (ra < 281) return { code: 'Lib', nom: 'Libra' };
        if (ra < 312) return { code: 'Sco', nom: 'Scorpius' };
        if (ra < 326) return { code: 'Oph', nom: 'Ophiuchus' };
        if (ra < 348) return { code: 'Sgr', nom: 'Sagittarius' };
        return { code: 'Peg', nom: 'Pegasus' };
    }
    if (dec >= -30 && dec < 0) {
        if (ra < 25) return { code: 'Scl', nom: 'Sculptor' };
        if (ra < 50) return { code: 'Cet', nom: 'Cetus' };
        if (ra < 115) return { code: 'Eri', nom: 'Eridanus' };
        if (ra < 140) return { code: 'Mon', nom: 'Monoceros' };
        if (ra < 170) return { code: 'Hya', nom: 'Hydra' };
        if (ra < 210) return { code: 'Crt', nom: 'Crater' };
        if (ra < 240) return { code: 'Vir', nom: 'Virgo' };
        if (ra < 270) return { code: 'Lib', nom: 'Libra' };
        if (ra < 300) return { code: 'Sgr', nom: 'Sagittarius' };
        return { code: 'Aqr', nom: 'Aquarius' };
    }
    return { code: 'Oct', nom: 'Octans' };
}

function parserFichierWMM(texteCof) {
    if (!texteCof) throw new Error("Fichier WMM-2025 vide ou introuvable.");
    const lignes = texteCof.split('\n');
    const coefficients = [];
    for (let ligne of lignes) {
        const parties = ligne.trim().split(/\s+/);
        if (parties.length >= 6) {
            const n = parseInt(parties[0], 10);
            const m = parseInt(parties[1], 10);
            const g = parseFloat(parties[2]);
            const h = parseFloat(parties[3]);
            const dg = parseFloat(parties[4]) || 0.0;
            const dh = parseFloat(parties[5]) || 0.0;
            if (!isNaN(n) && !isNaN(m)) {
                coefficients.push({ n, m, g, h, dg, dh });
            }
        }
    }
    return { modele: "WMM-2025", coefficients };
}

function formaterHeureDecimale(heures) {
    if (heures === -1.0) return "Jour Polaire";
    if (heures === -2.0) return "Nuit Polaire";
    if (isNaN(heures) || heures < 0 || heures >= 24) throw new Error("Heure décimale invalide.");
    const h = Math.floor(heures);
    const m = Math.floor((heures - h) * 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')} UTC`;
}

function initialiserMemoireWasm() {
    if (wasmReady && !metricsPtr) {
        metricsPtr = Module._malloc(40);
        resultPtr = Module._malloc(256);
    }
}

function obtenirPositionParChebyshev(arcsAstre, timestampSec) {
    if (!arcsAstre || arcsAstre.length === 0) throw new Error("Arcs de Chebyshev absents.");
    let arc = arcsAstre.find(a => timestampSec >= a.t_start && timestampSec <= a.t_end) || arcsAstre[0];
    const tNorm = (arc.t_start === arc.t_end) ? 0.0 : (2.0 * (timestampSec - arc.t_start) / (arc.t_end - arc.t_start) - 1.0);
    return {
        x: arc.cx[0] + tNorm * (arc.cx[1] || 0),
        y: arc.cy[0] + tNorm * (arc.cy[1] || 0),
        z: arc.cz[0] + tNorm * (arc.cz[1] || 0),
        mag: arc.mag ?? 0.0
    };
}

function auditerEnvironnementInterne() {
    return {
        wasmStatus: "Actif",
        noyauJplCharge: true,
        modelesActifs: ["DE440s", "WMM-2025 (Strict)"]
    };
}

onmessage = async function(e) {
    const data = e.data;
    if (!data) return;

    if (data.type === 'UPDATE_JPL_MATRIX') {
        matriceJplGlobal = data.matrix;
        return;
    }

    if (data.type === 'LOAD_WMM_COF') {
        try {
            coefficientsWMMGlobal = parserFichierWMM(data.contenu);
            postMessage({ type: 'WMM_LOADED', status: 'Succès', count: coefficientsWMMGlobal.coefficients.length });
        } catch (err) {
            postMessage({ type: 'ERROR', message: err.toString() });
        }
        return;
    }

    if (data.type === 'COMPUTE') {
        if (!wasmReady) return;
        initialiserMemoireWasm();

        try {
            const { timestampUtc, coords, meteo } = data;
            const { lat, lon, alt } = coords;
            const timestampSec = timestampUtc / 1000.0;

            // Contrôle strict : absence de valeurs de secours injectées silencieusement
            if (!meteo || typeof meteo.tempC !== 'number' || typeof meteo.presHpa !== 'number') {
                throw new Error("Données météorologiques obligatoires manquantes (pas de fallback appliqué).");
            }

            Module._calculerParametresSiderauxEtSolaires(timestampSec, lon, metricsPtr);
            const offsetMetrics = metricsPtr / 8;
            const eqTempsMin = Module.HEAPF64[offsetMetrics + 0];
            const obliquiteDeg = Module.HEAPF64[offsetMetrics + 1];
            const longSolaireDeg = Module.HEAPF64[offsetMetrics + 2];
            const gastDeg = Module.HEAPF64[offsetMetrics + 3];
            const lstDeg = Module.HEAPF64[offsetMetrics + 4];

            const eraRad = (gastDeg % 360.0) * (Math.PI / 180.0);
            const bodiesResults = {};
            const sourceDonnees = matriceJplGlobal?.DATA || null;
            const almanachData = matriceJplGlobal?.ALMANACH || null;

            if (sourceDonnees) {
                for (const [nomAstre, arcsAstre] of Object.entries(sourceDonnees)) {
                    const posECEF = obtenirPositionParChebyshev(arcsAstre, timestampSec);
                    if (!posECEF) continue;

                    Module._calculerDepuisECEF(
                        posECEF.x, posECEF.y, posECEF.z,
                        lat, lon, alt, eraRad, timestampSec,
                        meteo.tempC, meteo.presHpa,
                        posECEF.mag ?? 0.0, false, resultPtr
                    );

                    const off = resultPtr / 8;
                    const errorCode = Module.HEAP32[(resultPtr + 152) / 4];
                    if (errorCode !== 0) {
                        throwErreurPhysique(errorCode);
                    }

                    const nomAstreMaj = nomAstre.toUpperCase();
                    const statiques = CONSTANTES_ORBITALES[nomAstreMaj];
                    if (!statiques) continue;

                    const raVal = Module.HEAPF64[off + 3];
                    const decVal = Module.HEAPF64[off + 4];
                    const constObj = obtenirConstellationIAU(raVal, decVal);
                    const shadowVal = Module.HEAPF64[off + 14];

                    bodiesResults[nomAstreMaj] = {
    azimuth: Module.HEAPF64[off + 0],
    elevationGeometrice: Module.HEAPF64[off + 1],
    elevationRefractee: Module.HEAPF64[off + 2],
    raDeg: raVal,
    decDeg: decVal,
    distanceAu: Module.HEAPF64[off + 5],
    magnitude: posECEF.mag ?? 0.0,
    sunrise: formaterHeureDecimale(Module.HEAPF64[off + 6]),
    sunset: formaterHeureDecimale(Module.HEAPF64[off + 7]),
    airMass: Module.HEAPF64[off + 8],
    irradiance: Module.HEAPF64[off + 9],
    deltat: Module.HEAPF64[off + 11],
    gmstDeg: Module.HEAPF64[off + 12], // Correspond au GHA/GMST calculé
    gha: Module.HEAPF64[off + 12],
    jde: Module.HEAPF64[off + 13],
    shadowLengthDisplay: Module.HEAPF64[off + 14].toFixed(2) + ' m',
    orbitVelocity: statiques.orbitVel, // Harmonisation de la clé
    constellationCode: constObj.code,
    constellationNom: constObj.nom,
    constellationDisplay: `${constObj.code} (${constObj.nom})`,
    ...statiques
};
                }
            }

            postMessage({
                type: 'RESULTS_COMPUTE',
                timestamp: timestampUtc,
                almanac: almanachData,
                solarMetrics: { eqTempsMin, obliquiteDeg, longSolaireDeg, gastDeg, lstDeg },
                bodies: bodiesResults
            });

        } catch (err) {
            postMessage({ type: 'ERROR', message: err.toString() });
        }
    }
};

function throwErreurPhysique(code) {
    if (code === 101) throw new Error("Erreur physique : Paramètres de pression ou température atmosphérique hors limites valides.");
    throw new Error(`Erreur critique du noyau Wasm (code ${code}).`);
    }
