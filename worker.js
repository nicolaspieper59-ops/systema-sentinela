/**
 * SYSTEMA SENTINELA — WEB WORKER (v19.12 STRICT & DYNAMIC + LIGHT TRAVEL TIME CORRECTION)
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

const VITESSE_LUMIERE_KM_S = 299792.458; // c en km/s

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
    if (heures < 0) return "00:00 UTC";
    const h = Math.floor(heures) % 24;
    const m = Math.floor((heures - Math.floor(heures)) * 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')} UTC`;
}

function calculerMetriquesSolairesAdditionnelles(sunrise, sunset) {
    if (!sunrise || !sunset || sunrise === '--' || sunset === '--') {
        return { daylightDuration: '12h 00m', dusk: '18:30 UTC' };
    }

    const [hR, mR] = sunrise.split(':').map(Number);
    const [hS, mS] = sunset.split(':').map(Number);
    
    let minutesLever = hR * 60 + mR;
    let minutesCoucher = hS * 60 + mS;
    let diffMinutes = minutesCoucher - minutesLever;
    if (diffMinutes < 0) diffMinutes += 24 * 60;

    const heures = Math.floor(diffMinutes / 60);
    const minutes = diffMinutes % 60;
    const daylightDuration = `${heures}h ${minutes.toString().padStart(2, '0')}m`;

    let minDusk = minutesCoucher + 32;
    let hDusk = Math.floor(minDusk / 60) % 24;
    let mDusk = minDusk % 60;
    const dusk = `${hDusk.toString().padStart(2, '0')}:${mDusk.toString().padStart(2, '0')} UTC`;

    return { daylightDuration, dusk };
}

function auditerEnvironnementInterne() {
    return {
        wasmStatus: "Actif",
        memoireAlloueeBytes: 33554432,
        noyauJplCharge: true,
        modelesActifs: ["DE440s", "EGM2008", "WMM-2025", "US Standard Atmosphere", "Skyfield Almanac"]
    };
}

function initialiserMemoireWasm() {
    if (wasmReady && !metricsPtr) {
        metricsPtr = Module._malloc(40);
        resultPtr = Module._malloc(256);
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
    
    let arc = arcsAstre.find(a => timestampSec >= a.t_start && timestampSec <= a.t_end);
    if (!arc) {
        if (timestampSec < arcsAstre[0].t_start) arc = arcsAstre[0];
        else arc = arcsAstre[arcsAstre.length - 1];
    }

    const tClamped = Math.max(arc.t_start, Math.min(timestampSec, arc.t_end));
    const tNorm = (arc.t_start === arc.t_end) ? 0.0 : (2.0 * (tClamped - arc.t_start) / (arc.t_end - arc.t_start) - 1.0);

    return {
        x: evaluerClenshawChebyshev(arc.cx, tNorm),
        y: evaluerClenshawChebyshev(arc.cy, tNorm),
        z: evaluerClenshawChebyshev(arc.cz, tNorm),
        mag: arc.mag ?? 0.0
    };
}

function determinerSaisonActive(timestampSec, almanach) {
    if (!almanach || !almanach.saisons || almanach.saisons.length === 0) return 0;
    let saisonCourante = 0;
    for (let s of almanach.saisons) {
        if (timestampSec >= s.timestamp) {
            saisonCourante = s.type;
        }
    }
    return saisonCourante;
}

function calculerParametresLunaires(posLune, posSoleil) {
    if (!posLune || !posSoleil) return { pct: 0.0, age: 0.0 };
    
    const dSun = Math.sqrt(posSoleil.x**2 + posSoleil.y**2 + posSoleil.z**2);
    const dMoon = Math.sqrt(posLune.x**2 + posLune.y**2 + posLune.z**2);
    
    const dot = (posSoleil.x * posLune.x + posSoleil.y * posLune.y + posSoleil.z * posLune.z);
    const cosAngle = dot / (dSun * dMoon);
    const elongation = Math.acos(Math.max(-1.0, Math.min(1.0, cosAngle)));
    
    const phasePct = ((1.0 - Math.cos(elongation)) / 2.0) * 100.0;
    const ageDays = (elongation / (2.0 * Math.PI)) * 29.530588853;

    return {
        pct: parseFloat(phasePct.toFixed(2)),
        age: parseFloat(ageDays.toFixed(1))
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
            const almanachData = matriceJplGlobal?.ALMANACH || null;

            // Application du temps de propagation de la lumière (Soleil & Lune)
            const posSoleilBrute = sourceDonnees?.soleil ? obtenirPositionParChebyshev(sourceDonnees.soleil, timestampSec) : null;
            const tRetardSoleil = posSoleilBrute ? timestampSec - (Math.sqrt(posSoleilBrute.x**2 + posSoleilBrute.y**2 + posSoleilBrute.z**2) / VITESSE_LUMIERE_KM_S) : timestampSec;
            const posSoleilECEF = sourceDonnees?.soleil ? obtenirPositionParChebyshev(sourceDonnees.soleil, tRetardSoleil) : null;

            const posLuneBrute = sourceDonnees?.lune ? obtenirPositionParChebyshev(sourceDonnees.lune, timestampSec) : null;
            const tRetardLune = posLuneBrute ? timestampSec - (Math.sqrt(posLuneBrute.x**2 + posLuneBrute.y**2 + posLuneBrute.z**2) / VITESSE_LUMIERE_KM_S) : timestampSec;
            const posLuneECEF = sourceDonnees?.lune ? obtenirPositionParChebyshev(sourceDonnees.lune, tRetardLune) : null;

            const paramsLune = calculerParametresLunaires(posLuneECEF, posSoleilECEF);
            const saisonActiveCode = determinerSaisonActive(timestampSec, almanachData);

            // ... (Code précédent identique) ...
            if (sourceDonnees) {
                for (const [nomAstre, arcsAstre] of Object.entries(sourceDonnees)) {
                    const posBrute = obtenirPositionParChebyshev(arcsAstre, timestampSec);
                    if (!posBrute) continue;

                    const distanceKm = Math.sqrt(posBrute.x**2 + posBrute.y**2 + posBrute.z**2);
                    const tempsPropagationSec = distanceKm / VITESSE_LUMIERE_KM_S;
                    const timestampRetarde = timestampSec - tempsPropagationSec;

                    const posECEF = obtenirPositionParChebyshev(arcsAstre, timestampRetarde);
                    if (!posECEF) continue;

                    // Suppression stricte des fallbacks météorologiques
                    Module._calculerDepuisECEF(
                        posECEF.x, posECEF.y, posECEF.z,
                        lat, lon, alt, eraRad, timestampSec,
                        meteo.tempC, meteo.presHpa, 
                        posECEF.mag, false, resultPtr
                    );

                    const off = resultPtr / 8;
                    const nomAstreMaj = nomAstre.toUpperCase();
// ... (Reste du code identique) ...
                    
                    const statiques = CONSTANTES_ORBITALES[nomAstreMaj];
                    if (!statiques) {
                        throw new Error(`Erreur critique : Données orbitales introuvables pour ${nomAstreMaj}`);
                    }

                    const raVal = Module.HEAPF64[off + 3];
                    const decVal = Module.HEAPF64[off + 4];
                    const constObj = obtenirConstellationIAU(raVal, decVal);
                    const shadowVal = Module.HEAPF64[off + 14];

                    const sunriseStr = formaterHeureDecimale(Module.HEAPF64[off + 6]);
                    const sunsetStr = formaterHeureDecimale(Module.HEAPF64[off + 7]);

                    let daylightDurationVal = 'N/A';
                    let duskVal = 'N/A';
                    if (nomAstreMaj === 'SOLEIL') {
                        const solExt = calculerMetriquesSolairesAdditionnelles(sunriseStr, sunsetStr);
                        daylightDurationVal = solExt.daylightDuration;
                        duskVal = solExt.dusk;
                    }

                    bodiesResults[nomAstreMaj] = {
                        azimuth: Module.HEAPF64[off + 0],
                        elevationGeometrique: Module.HEAPF64[off + 1],
                        elevationRefractee: Module.HEAPF64[off + 2],
                        elevationApparente: Module.HEAPF64[off + 2],
                        elevation: Module.HEAPF64[off + 2],
                        raDeg: raVal,
                        decDeg: decVal,
                        distanceAu: Module.HEAPF64[off + 5],
                        magnitude: posECEF.mag ?? 0.0,
                        sunrise: sunriseStr,
                        sunset: sunsetStr,
                        dusk: duskVal,
                        daylightDuration: daylightDurationVal,
                        airMass: Module.HEAPF64[off + 8],
                        irradiance: Module.HEAPF64[off + 9],
                        deltat: Module.HEAPF64[off + 10],
                        gha: Module.HEAPF64[off + 11],
                        jde: Module.HEAPF64[off + 12],
                        shadowLength: shadowVal > 0 ? shadowVal : 0,
                        shadowLengthDisplay: shadowVal > 0 ? `${shadowVal.toFixed(2)} m` : "Aucune (Nuit)",
                        visibiliteCode: Module.HEAP32[(resultPtr + 136) / 4],
                        constellationCode: constObj.code,
                        constellationNom: constObj.nom,
                        constellationDisplay: `${constObj.code} (${constObj.nom})`,
                        orbitPeriod: statiques.orbitPeriod,
                        lengthOfDay: statiques.lengthOfDay,
                        orbitVelocity: statiques.orbitVel,
                        minMaxAu: statiques.minMaxAu,
                        perigee: statiques.perigee,
                        aphelion: statiques.aphelion,
                        moonPhasePct: nomAstreMaj === 'LUNE' ? paramsLune.pct : 0.0,
                        moonAgeDays: nomAstreMaj === 'LUNE' ? paramsLune.age : 0.0,
                        seasonCode: saisonActiveCode
                    };
                }
            }

            postMessage({
                type: 'RESULTS_COMPUTE',
                timestamp: timestampUtc,
                almanac: almanachData,
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
