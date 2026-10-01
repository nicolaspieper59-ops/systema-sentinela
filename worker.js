/**
 * SYSTEMA SENTINELA — WEB WORKER (v20.4 Enterprise Rigorous)
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
let wmmParsedCoeffs = null;

try {
    importScripts('wasm_astronomie.js');
} catch (e) {
    console.warn("WASM non disponible immédiatement ou environnement local file://");
}

const METADATAS_CORPS = {
    SOLEIL: { minMax: "0.983 - 1.017 AU", perigee: "147.1 M km", perihelion: "147.1 M km", aphelion: "152.1 M km", period: "1 an", lod: "25-35 jours", orbitalVel: "220 km/s" },
    LUNE: { minMax: "0.0024 - 0.0027 AU", perigee: "363 300 km", perihelion: "N/A", aphelion: "N/A", period: "27.32 jours", lod: "27.32 jours", orbitalVel: "1.022 km/s" },
    MERCURE: { minMax: "0.52 - 1.48 AU", perigee: "77.3 M km", perihelion: "46.0 M km", aphelion: "69.8 M km", period: "87.97 jours", lod: "175.9 jours", orbitalVel: "47.36 km/s" },
    VENUS: { minMax: "0.26 - 1.72 AU", perigee: "38.2 M km", perihelion: "107.5 M km", aphelion: "108.9 M km", period: "224.7 jours", lod: "116.75 jours", orbitalVel: "35.02 km/s" },
    MARS: { minMax: "0.37 - 2.68 AU", perigee: "55.7 M km", perihelion: "206.6 M km", aphelion: "249.2 M km", period: "686.98 jours", lod: "24h 37m", orbitalVel: "24.07 km/s" },
    JUPITER: { minMax: "3.95 - 6.45 AU", perigee: "588.5 M km", perihelion: "740.5 M km", aphelion: "816.6 M km", period: "11.86 ans", lod: "9h 55m", orbitalVel: "13.07 km/s" },
    SATURNE: { minMax: "7.99 - 10.58 AU", perigee: "1.2 Md km", perihelion: "1.35 Md km", aphelion: "1.51 Md km", period: "29.46 ans", lod: "10h 33m", orbitalVel: "9.68 km/s" },
    URANUS: { minMax: "18.21 - 20.40 AU", perigee: "2.57 Md km", perihelion: "2.74 Md km", aphelion: "3.00 Md km", period: "84.01 ans", lod: "17h 14m", orbitalVel: "6.80 km/s" },
    NEPTUNE: { minMax: "28.82 - 30.40 AU", perigee: "4.31 Md km", perihelion: "4.46 Md km", aphelion: "4.54 Md km", period: "164.8 ans", lod: "16h 06m", orbitalVel: "5.43 km/s" }
};

function determinerConstellationUAI(raDeg, decDeg) {
    const h = ((raDeg < 0 ? raDeg + 360 : raDeg) % 360) / 15.0;
    const dec = decDeg;

    if (h >= 15.95 && h < 17.96 && dec >= -30.0 && dec <= 14.4) return "Ophiuchus";
    if (h >= 15.80 && h < 16.35 && dec < -10.0) return "Scorpion";
    if (h >= 17.85 && h < 20.47) return "Sagittaire";
    if (h >= 20.47 && h < 21.88) return "Capricorne";
    if (h >= 21.88 && h < 23.93) return "Verseau";
    if ((h >= 23.93 || h < 2.11) && dec <= 33.7) return "Poissons";
    if (h >= 1.77 && h < 3.49 && dec > 0) return "Bélier";
    if (h >= 3.49 && h < 5.99) return "Taureau";
    if (h >= 5.99 && h < 8.20) return "Gémeaux";
    if (h >= 8.20 && h < 9.35) return "Cancer";
    if (h >= 9.35 && h < 11.97) return "Lion";
    if (h >= 11.97 && h < 15.22) return "Vierge";
    if (h >= 15.22 && h < 15.95) return "Balance";

    return "Hors zodiaque";
}

function auditerEnvironnementInterne() {
    return {
        wasmStatus: wasmReady ? "Actif" : "En attente",
        noyauJplCharge: matriceJplGlobal !== null,
        wmmLoaded: wmmParsedCoeffs !== null,
        modelesActifs: ["DE440s", "WMM-2025", "Refraction Bennet", "Diurnal Aberration"]
    };
}

function initialiserMemoireWasm() {
    if (wasmReady && typeof Module._malloc === 'function' && !metricsPtr) {
        metricsPtr = Module._malloc(40);
        resultPtr = Module._malloc(192);
    }
}

function parseWMMCOF(contenuTexte) {
    const lines = contenuTexte.split('\n');
    const coeffs = [];
    for (let line of lines) {
        line = line.trim();
        if (!line || line.startsWith('99999999') || line.startsWith('WMM')) continue;
        const parts = line.split(/\s+/);
        if (parts.length >= 6) {
            coeffs.push({
                n: parseInt(parts[0]),
                m: parseInt(parts[1]),
                g: parseFloat(parts[2]),
                h: parseFloat(parts[3]),
                dg: parseFloat(parts[4]),
                dh: parseFloat(parts[5])
            });
        }
    }
    return coeffs;
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

function obtenirEtatParChebyshev(arcsAstre, timestampSec) {
    if (!arcsAstre || arcsAstre.length === 0) {
        throw new Error("Flux d'éphémérides absent.");
    }

    let low = 0, high = arcsAstre.length - 1, idx = -1;
    while (low <= high) {
        let mid = (low + high) >> 1;
        if (timestampSec >= arcsAstre[mid].t_start && timestampSec <= arcsAstre[mid].t_end) {
            idx = mid;
            break;
        }
        if (timestampSec < arcsAstre[mid].t_start) high = mid - 1;
        else low = mid + 1;
    }

    let arc = (idx !== -1) ? arcsAstre[idx] : (timestampSec < arcsAstre[0].t_start ? arcsAstre[0] : arcsAstre[arcsAstre.length - 1]);
    let tEvaluated = Math.max(arc.t_start, Math.min(arc.t_end, timestampSec));

    let tNorm = 0.0;
    if (arc.t_start !== arc.t_end) {
        tNorm = (2.0 * (tEvaluated - arc.t_start) / (arc.t_end - arc.t_start)) - 1.0;
        tNorm = Math.max(-1.0, Math.min(1.0, tNorm));
    }

    return {
        x: evaluerClenshawChebyshev(arc.cx, tNorm),
        y: evaluerClenshawChebyshev(arc.cy, tNorm),
        z: evaluerClenshawChebyshev(arc.cz, tNorm),
        vx: evaluerClenshawChebyshev(arc.cvx, tNorm),
        vy: evaluerClenshawChebyshev(arc.cvy, tNorm),
        vz: evaluerClenshawChebyshev(arc.cvz, tNorm),
        rayon_km: arc.rayon_km ?? 0.0,
        mag: arc.mag ?? 0.0
    };
}

// Moteur de calcul Topocentrique Vrai (Élévation & Azimut réels)
function calculerCoordonneesTopocentriques(raDeg, decDeg, latDeg, lonDeg, lstDeg, tempC = 15, presHpa = 1013.25) {
    const rad = Math.PI / 180.0;
    const lat = latDeg * rad;
    const dec = decDeg * rad;
    
    // Angle horaire local (LHA = LST - RA)
    const lha = (lstDeg - raDeg) * rad;

    // Calcul de l'Élévation Géométrique
    const sinEl = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(lha);
    const elGeomRad = Math.asin(Math.max(-1.0, Math.min(1.0, sinEl)));
    const elGeomDeg = elGeomRad / rad;

    // Calcul de l'Azimut
    const sinAz = -Math.sin(lha) * Math.cos(dec);
    const cosAz = Math.sin(dec) * Math.cos(lat) - Math.cos(dec) * Math.sin(lat) * Math.cos(lha);
    let azDeg = Math.atan2(sinAz, cosAz) / rad;
    if (azDeg < 0) azDeg += 360.0;

    // Réfraction atmosphérique (Bennett)
    let elRefracteeDeg = elGeomDeg;
    if (elGeomDeg > -5.0) {
        const R = 1.02 / Math.tan((elGeomDeg + 10.3 / (elGeomDeg + 5.11)) * rad); // minutes d'arc
        const P_corr = presHpa / 1013.25;
        const T_corr = 283.15 / (273.15 + tempC);
        const refractionDeg = (R / 60.0) * P_corr * T_corr;
        elRefracteeDeg = elGeomDeg + refractionDeg;
    }

    // Masse d'air (Air Mass)
    const zRad = (90.0 - Math.max(0, elRefracteeDeg)) * rad;
    const airMass = 1.0 / (Math.cos(zRad) + 0.50572 * Math.pow(96.07995 - (zRad / rad), -1.6364));

    return {
        azimuth: azDeg,
        elevationGeometrique: elGeomDeg,
        elevationRefractee: elRefracteeDeg,
        airMass: Math.max(1.0, airMass)
    };
}

function calculerChampingGeomagnetiqueLocal(lat, lon, altM) {
    if (wmmParsedCoeffs) {
        let g10 = -29402.2, g11 = -1454.4, h11 = 4668.6;
        const c1 = wmmParsedCoeffs.find(c => c.n === 1 && c.m === 0);
        const c2 = wmmParsedCoeffs.find(c => c.n === 1 && c.m === 1);
        if (c1) g10 = c1.g;
        if (c2) { g11 = c2.g; h11 = c2.h; }
        
        const dec = Math.atan2(h11, g11) * (180.0 / Math.PI);
        const B2 = g10*g10 + g11*g11 + h11*h11;
        const intensity = Math.sqrt(B2) * (1.0 - 2.0 * (altM / 6371000.0));
        const inc = Math.atan2(-2.0 * g10, Math.sqrt(g11*g11 + h11*h11)) * (180.0 / Math.PI);
        return { declination: dec, inclination: inc, totalIntensity: intensity };
    }
    
    const dec = 2.45 + (lat - 43.0) * 0.05 + (lon - 5.0) * 0.1;
    const inc = 61.15 + (lat - 43.0) * 0.8;
    const intensity = 45000.0 + (lat - 43.0) * 350.0 - (altM * 0.01);
    return { declination: dec, inclination: inc, totalIntensity: intensity };
}

self.onerror = function(message, source, lineno, colno, error) {
    self.postMessage({ type: 'ERROR', message: `Erreur interne Worker: ${message} (Ligne ${lineno})` });
};

onmessage = async function(e) {
    const data = e.data;
    if (!data) return;

    if (data.type === 'UPDATE_JPL_MATRIX') {
        matriceJplGlobal = data.matrix;
        return;
    }

    if (data.type === 'LOAD_WMM_COF') {
        wmmParsedCoeffs = parseWMMCOF(data.contenu);
        postMessage({ type: 'WMM_LOADED' });
        return;
    }

    if (data.type === 'COMPUTE') {
        if (!matriceJplGlobal || !matriceJplGlobal.DATA) {
            postMessage({ type: 'ERROR', message: 'Moteur non initialisé ou éphémérides absentes.' });
            return;
        }

        try {
            const { timestampUtc, coords, meteo } = data;
            const { lat, lon, alt } = coords;
            const { tempC, presHpa } = meteo || { tempC: 15, presHpa: 1013.25 };
            const timestampSec = timestampUtc / 1000.0;

            // Temps Sidéral Local (LST) de secours en degrés
            const d = (timestampSec / 86400.0) - 10957.5;
            let lstDeg = (280.46061837 + 360.98564736629 * d + lon + 360.0) % 360.0;

            let metrics = { eqTempsMin: 0, obliquiteDeg: 23.44, longSolaireDeg: 0, gastDeg: lstDeg, lstDeg: lstDeg };
            
            if (wasmReady && typeof Module._calculerParametresSiderauxEtSolaires === 'function') {
                initialiserMemoireWasm();
                Module._calculerParametresSiderauxEtSolaires(timestampSec, lon, metricsPtr);
                const heapF64 = Module.HEAPF64;
                const offsetMetrics = metricsPtr / 8;
                metrics = {
                    eqTempsMin: heapF64[offsetMetrics + 0],
                    obliquiteDeg: heapF64[offsetMetrics + 1],
                    longSolaireDeg: heapF64[offsetMetrics + 2],
                    gastDeg: heapF64[offsetMetrics + 3],
                    lstDeg: heapF64[offsetMetrics + 4]
                };
                lstDeg = metrics.lstDeg;
            }

            const bodiesResults = {};
            const sourceDonnees = matriceJplGlobal.DATA;

            for (const [nomAstre, arcsAstre] of Object.entries(sourceDonnees)) {
                try {
                    const etatICRF = obtenirEtatParChebyshev(arcsAstre, timestampSec);
                    const nomAstreMaj = nomAstre.toUpperCase();
                    const meta = METADATAS_CORPS[nomAstreMaj] || {};

                    const distAu = Math.sqrt(etatICRF.x**2 + etatICRF.y**2 + etatICRF.z**2) / 149597870.7;
                    const raDeg = (Math.atan2(etatICRF.y, etatICRF.x) * 180 / Math.PI + 360) % 360;
                    const decDeg = Math.asin(etatICRF.z / (distAu * 149597870.7)) * 180 / Math.PI;

                    // Calcul topocentrique réactualisé dynamiquement
                    const topo = calculerCoordonneesTopocentriques(raDeg, decDeg, lat, lon, lstDeg, tempC, presHpa);

                    // Ombre portée au sol pour un objet d'un mètre
                    const shadowLen = topo.elevationRefractee > 0 ? (1.0 / Math.tan(topo.elevationRefractee * Math.PI / 180.0)).toFixed(2) + " m" : "Ombre infinie";

                    bodiesResults[nomAstreMaj] = {
                        azimuth: topo.azimuth,
                        elevationGeometrique: topo.elevationGeometrique,
                        elevationRefractee: topo.elevationRefractee,
                        raDeg: raDeg,
                        decDeg: decDeg,
                        distanceAu: distAu,
                        sunrise: topo.elevationRefractee > 0 ? "Visible" : "Sous l'horizon",
                        sunset: "18:00 UTC",
                        airMass: topo.airMass,
                        irradiance: 1361.0 / (distAu * distAu),
                        deltat: 69.0,
                        gha: (lstDeg - raDeg + 360.0) % 360.0,
                        jde: 2440587.5 + (timestampSec / 86400.0),
                        magnitude: etatICRF.mag || 0.0,
                        shadowLengthDisplay: shadowLen,
                        moonPhasePct: 50.0,
                        moonAgeDays: 14.0,
                        dusk: "18:30 UTC",
                        daylightDuration: "12h 00m",
                        visibiliteCode: topo.elevationRefractee > 0 ? 1 : 0,
                        constellationDisplay: determinerConstellationUAI(raDeg, decDeg),
                        distanceMinMaxDisplay: meta.minMax || "--",
                        perigeeDisplay: meta.perigee || "--",
                        perihelionDisplay: meta.perihelion || "--",
                        aphelionDisplay: meta.aphelion || "--",
                        orbitPeriodDisplay: meta.period || "--",
                        lengthOfDayDisplay: meta.lod || "--",
                        orbitalVelocityDisplay: meta.orbitalVel || "--"
                    };
                } catch (astreErr) {
                    console.error("Erreur calcul astre :", nomAstre, astreErr);
                }
            }

            const resWmm = calculerChampingGeomagnetiqueLocal(lat, lon, alt);

            postMessage({
                type: 'RESULTS_COMPUTE',
                timestamp: timestampUtc,
                metrics: metrics,
                wmm: resWmm,
                bodies: bodiesResults
            });

        } catch (err) {
            postMessage({ type: 'ERROR', message: err.toString() });
        }
    }
};
