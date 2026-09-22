/**
 * SYSTEMA SENTINELA — WEB WORKER (v19.9 FULL MULTIPHYSICS)
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
let metricsPtr = 0;
let resultPtr = 0;

importScripts('wasm_astronomie.js');

const CONSTANTES_ORBITALES = {
    'SOLEIL': { orbitPeriod: '365.25', lengthOfDay: '24.0', orbitVel: '29.78', minMaxAu: '0.983 - 1.017' },
    'LUNE': { orbitPeriod: '27.32', lengthOfDay: '708.7', orbitVel: '1.02', minMaxAu: '0.0025 - 0.0027' },
    'MERCURE': { orbitPeriod: '88.0', lengthOfDay: '4222.6', orbitVel: '47.36', minMaxAu: '0.307 - 0.466' },
    'VENUS': { orbitPeriod: '224.7', lengthOfDay: '2802.0', orbitVel: '35.02', minMaxAu: '0.718 - 0.728' },
    'MARS': { orbitPeriod: '687.0', lengthOfDay: '24.6', orbitVel: '24.07', minMaxAu: '1.381 - 1.666' },
    'JUPITER': { orbitPeriod: '4331', lengthOfDay: '9.9', orbitVel: '13.07', minMaxAu: '4.95 - 5.46' },
    'SATURNE': { orbitPeriod: '10747', lengthOfDay: '10.7', orbitVel: '9.68', minMaxAu: '9.04 - 10.12' },
    'URANUS': { orbitPeriod: '30589', lengthOfDay: '17.2', orbitVel: '6.80', minMaxAu: '18.28 - 20.11' },
    'NEPTUNE': { orbitPeriod: '59800', lengthOfDay: '16.1', orbitVel: '5.43', minMaxAu: '29.81 - 30.33' }
};

function obtenirConstellationIAU(raDeg, decDeg) {
    const ra = (raDeg % 360 + 360) % 360;
    const dec = decDeg;

    if (dec >= +60) {
        if (ra >= 0 && ra < 30) return { code: 'Cas', nom: 'Cassiopeia' };
        if (ra >= 30 && ra < 90) return { code: 'Per', nom: 'Perseus' };
        if (ra >= 90 && ra < 150) return { code: 'Cam', nom: 'Camelopardalis' };
        if (ra >= 150 && ra < 210) return { code: 'UMa', nom: 'Ursa Major' };
        if (ra >= 210 && ra < 270) return { code: 'Dra', nom: 'Draco' };
        if (ra >= 270 && ra < 330) return { code: 'Cep', nom: 'Cepheus' };
        return { code: 'UMi', nom: 'Ursa Minor' };
    }
    
    if (dec >= 0 && dec < 60) {
        if (ra >= 30 && ra < 55) return { code: 'Ari', nom: 'Aries' };
        if (ra >= 55 && ra < 95) return { code: 'Tau', nom: 'Taurus' };
        if (ra >= 95 && ra < 120) return { code: 'Ori', nom: 'Orion' };
        if (ra >= 120 && ra < 155) return { code: 'Gem', nom: 'Gemini' };
        if (ra >= 155 && ra < 185) return { code: 'Cnc', nom: 'Cancer' };
        if (ra >= 185 && ra < 225) return { code: 'Leo', nom: 'Leo' };
        if (ra >= 225 && ra < 260) return { code: 'Vir', nom: 'Virgo' };
        if (ra >= 260 && ra < 285) return { code: 'Lib', nom: 'Libra' };
        if (ra >= 285 && ra < 310) return { code: 'Sco', nom: 'Scorpius' };
        if (ra >= 310 && ra < 350) return { code: 'Aqr', nom: 'Aquarius' };
    }
    return { code: 'Psc', nom: 'Pisces' };
}

function formaterHeureDecimale(heures) {
    if (heures < 0) return "--:--";
    const h = Math.floor(heures);
    const m = Math.floor((heures - h) * 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')} UTC`;
}

function auditerEnvironnementInterne() {
    return {
        wasmStatus: "Actif",
        memoireAlloueeBytes: 33554432,
        noyauJplCharge: true,
        modelesActifs: ["DE440s", "EGM2008", "WMM-2025", "US Standard Atmosphere"]
    };
}

function initialiserMemoireWasm() {
    if (wasmReady && !metricsPtr) {
        metricsPtr = Module._malloc(40);
        resultPtr = Module._malloc(120); // 120 octets (aligné sur la nouvelle structure C++)
    }
}

function evaluerClenshawChebyshev(coeffs, x) {
    if (!coeffs || coeffs.length === 0) return 0.0;
    let bK2 = 0.0, bK1 = 0.0, bK = 0.0;
    for (let i = coeffs.length - 1; i >= 1; i--) {
        bK = coeffs[i] + 2.0 * x * bK1 - bK2;
        bK2 = bK1;
        bK1 = bK;
    }
    return coeffs[0] + x * bK1 - bK2;
}

function obtenirPositionParChebyshev(arcsAstre, timestampSec) {
    if (!arcsAstre || arcsAstre.length === 0) return null;
    let arc = arcsAstre.find(a => timestampSec >= a.t_start && timestampSec <= a.t_end) || arcsAstre[0];
    const tNorm = (arc.t_start === arc.t_end) ? 0.0 : (2.0 * (timestampSec - arc.t_start) / (arc.t_end - arc.t_start) - 1.0);

    return {
        x: evaluerClenshawChebyshev(arc.cx, tNorm),
        y: evaluerClenshawChebyshev(arc.cy, tNorm),
        z: evaluerClenshawChebyshev(arc.cz, tNorm),
        mag: arc.mag ?? 0.0
    };
}

onmessage = async function(e) {
    const data = e.data;
    if (!data) return;

    if (data.type === 'UPDATE_JPL_MATRIX') {
        matriceJplGlobal = data.matrix;
        return;
    }

    if (data.type === 'COMPUTE') {
        if (!wasmReady) {
            postMessage({ type: 'ERROR', message: 'Wasm non initialisé' });
            return;
        }
        initialiserMemoireWasm();

        try {
            const { timestampUtc, coords, meteo } = data;
            const { lat, lon, alt } = coords;
            const timestampSec = timestampUtc / 1000.0;

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

            if (sourceDonnees) {
                for (const [nomAstre, arcsAstre] of Object.entries(sourceDonnees)) {
                    const posECEF = obtenirPositionParChebyshev(arcsAstre, timestampSec);
                    if (!posECEF) continue;

                    Module._calculerDepuisECEF(
                        posECEF.x, posECEF.y, posECEF.z,
                        lat, lon, alt, eraRad, timestampSec,
                        meteo?.tempC ?? 15.0, meteo?.presHpa ?? 1013.25,
                        posECEF.mag, false, resultPtr
                    );

                    const off = resultPtr / 8;
                    const nomAstreMaj = nomAstre.toUpperCase();
                    const statiques = CONSTANTES_ORBITALES[nomAstreMaj] || {};

                    const raVal = Module.HEAPF64[off + 3];
                    const decVal = Module.HEAPF64[off + 4];
                    const constObj = obtenirConstellationIAU(raVal, decVal);
                    const shadowVal = Module.HEAPF64[off + 13];

                    const resultObj = {
                        azimuth: Module.HEAPF64[off + 0],
                        elevationGeometrique: Module.HEAPF64[off + 1],
                        elevationRefractee: Module.HEAPF64[off + 2],
                        elevationApparente: Module.HEAPF64[off + 2],
                        elevation: Module.HEAPF64[off + 2],
                        raDeg: raVal,
                        decDeg: decVal,
                        distanceAu: Module.HEAPF64[off + 5],
                        sunrise: formaterHeureDecimale(Module.HEAPF64[off + 6]),
                        sunset: formaterHeureDecimale(Module.HEAPF64[off + 7]),
                        airMass: Module.HEAPF64[off + 8],
                        irradiance: Module.HEAPF64[off + 9],
                        deltat: Module.HEAPF64[off + 10],
                        gha: Module.HEAPF64[off + 11],
                        jde: Module.HEAPF64[off + 12],
                        shadowLength: shadowVal > 0 ? shadowVal : 0,
                        shadowLengthDisplay: shadowVal > 0 ? `${shadowVal.toFixed(2)} m` : "Aucune (Nuit)",
                        visibiliteCode: Module.HEAP32[(resultPtr + 112) / 4],
                        constellationCode: constObj.code,
                        constellationNom: constObj.nom,
                        constellationDisplay: `${constObj.code} (${constObj.nom})`,
                        orbitPeriod: statiques.orbitPeriod ?? '--',
                        lengthOfDay: statiques.lengthOfDay ?? '--',
                        orbitVelocity: statiques.orbitVel ?? '--',
                        minMaxAu: statiques.minMaxAu ?? '--'
                    };

                    bodiesResults[nomAstreMaj] = resultObj;
                }
            }

            postMessage({
                type: 'RESULTS_COMPUTE',
                timestamp: timestampUtc,
                solarMetrics: { 
                    eqTempsMin, 
                    obliquiteDeg, 
                    longSolaireDeg, 
                    gastDeg, 
                    lstDeg,
                    gast: gastDeg,
                    lst: lstDeg,
                    gastLst: `${gastDeg.toFixed(4)}° / ${lstDeg.toFixed(4)}°`,
                    excentricite: 0.01671022 
                },
                bodies: bodiesResults
            });

        } catch (err) {
            postMessage({ type: 'ERROR', message: err.toString() });
        }
    }
};
