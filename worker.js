/**
 * SYSTEMA SENTINELA — WEB WORKER (v20.3 Kernel Fixed & Optimized)
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

importScripts('wasm_astronomie.js');

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

function determinerConstellation(raDeg, decDeg) {
    const raH = (raDeg % 360 + 360) % 360 / 15.0;
    if (raH >= 0.0 && raH < 2.1) return "Poissons";
    if (raH >= 2.1 && raH < 3.6) return "Bélier";
    if (raH >= 3.6 && raH < 6.0) return "Taureau";
    if (raH >= 6.0 && raH < 8.1) return "Gémeaux";
    if (raH >= 8.1 && raH < 9.4) return "Cancer";
    if (raH >= 9.4 && raH < 11.4) return "Lion";
    if (raH >= 11.4 && raH < 14.4) return "Vierge";
    if (raH >= 14.4 && raH < 15.4) return "Balance";
    if (raH >= 15.4 && raH < 16.4) return "Scorpion / Serpentaire";
    if (raH >= 16.4 && raH < 19.1) return "Sagittaire";
    if (raH >= 19.1 && raH < 20.9) return "Capricorne";
    if (raH >= 20.9 && raH < 23.0) return "Verseau";
    return "Poissons";
}

function formaterHeureDecimale(heures) {
    if (isNaN(heures) || heures === null || heures === undefined) return "--:-- UTC";
    const hNormalisees = ((heures % 24) + 24) % 24;
    const h = Math.floor(hNormalisees);
    const m = Math.floor((hNormalisees - h) * 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')} UTC`;
}

function formaterDureeHeures(heures) {
    if (isNaN(heures) || heures < 0) return "--h --m";
    const h = Math.floor(heures);
    const m = Math.floor((heures - h) * 60);
    return `${h}h ${m.toString().padStart(2, '0')}m`;
}

function auditerEnvironnementInterne() {
    return {
        wasmStatus: wasmReady ? "Actif" : "En attente",
        noyauJplCharge: matriceJplGlobal !== null,
        wmmLoaded: wmmParsedCoeffs !== null,
        modelesActifs: ["DE440s", "WMM-2025", "Mallama Photometry", "Diurnal Aberration"]
    };
}

function initialiserMemoireWasm() {
    if (wasmReady && !metricsPtr) {
        metricsPtr = Module._malloc(40);   // 5 x double (40 octets)
        resultPtr = Module._malloc(192);  // Struct AstroResult (192 octets)
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
                n: parseInt(parts[0], 10),
                m: parseInt(parts[1], 10),
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

function calculerChampingGeomagnetiqueLocal(lat, lon, altM) {
    const latRad = lat * (Math.PI / 180.0);
    const lonRad = lon * (Math.PI / 180.0);

    if (wmmParsedCoeffs && wmmParsedCoeffs.length > 0) {
        let X = 0.0, Y = 0.0, Z = 0.0;
        const rRatio = Math.pow(6371200.0 / (6371200.0 + altM), 3);

        for (const c of wmmParsedCoeffs) {
            if (c.n > 4) continue; // Approximation tronquée à n=4 pour performances du thread Worker
            const factor = Math.pow(rRatio, c.n + 2);
            const mLon = c.m * lonRad;
            const cosM = Math.cos(mLon);
            const sinM = Math.sin(mLon);

            const gPart = c.g * cosM + c.h * sinM;
            const hPart = c.g * sinM - c.h * cosM;

            X += factor * (gPart * Math.sin(c.n * latRad));
            Y += factor * (hPart * Math.sin(latRad));
            Z += factor * ((c.n + 1) * gPart * Math.cos(latRad));
        }

        const H = Math.sqrt(X * X + Y * Y);
        const dec = Math.atan2(Y, X) * (180.0 / Math.PI);
        const inc = Math.atan2(Z, H) * (180.0 / Math.PI);
        const totalIntensity = Math.sqrt(H * H + Z * Z) || 45000.0;

        return { declination: dec, inclination: inc, totalIntensity };
    }

    // Modèle empirique de secours (géodésique local)
    const dec = 2.45 + (lat - 43.0) * 0.05 + (lon - 5.0) * 0.12;
    const inc = 61.15 + (lat - 43.0) * 0.75;
    const totalIntensity = 45000.0 + (lat - 43.0) * 320.0 - (altM * 0.012);
    return { declination: dec, inclination: inc, totalIntensity };
}

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
        if (!wasmReady || !matriceJplGlobal || !matriceJplGlobal.DATA) {
            postMessage({ type: 'ERROR', message: 'Moteur non initialisé ou éphémérides absentes.' });
            return;
        }
        initialiserMemoireWasm();

        try {
            const { timestampUtc, coords, meteo } = data;
            const { lat, lon, alt } = coords;
            const timestampSec = timestampUtc / 1000.0;

            Module._calculerParametresSiderauxEtSolaires(timestampSec, lon, metricsPtr);

            // Re-vérification systématique de la référence mémoire Wasm
            const offsetMetrics = metricsPtr / 8;
            const heapF64Metrics = Module.HEAPF64;

            const eqTempsMin = heapF64Metrics[offsetMetrics + 0];
            const obliquiteDeg = heapF64Metrics[offsetMetrics + 1];
            const longSolaireDeg = heapF64Metrics[offsetMetrics + 2];
            const gastDeg = heapF64Metrics[offsetMetrics + 3];
            const lstDeg = heapF64Metrics[offsetMetrics + 4];

            const eraRad = (gastDeg % 360.0) * (Math.PI / 180.0);
            const bodiesResults = {};
            const sourceDonnees = matriceJplGlobal.DATA;

            let posSoleilICRF = { x: 0, y: 0, z: 0 };
            if (sourceDonnees['SOLEIL']) {
                posSoleilICRF = obtenirEtatParChebyshev(sourceDonnees['SOLEIL'], timestampSec);
            }

            for (const [nomAstre, arcsAstre] of Object.entries(sourceDonnees)) {
                try {
                    const etatICRF = obtenirEtatParChebyshev(arcsAstre, timestampSec);
                    const estLune = (nomAstre.toUpperCase() === 'LUNE');

                    Module._calculerDepuisECEF(
                        etatICRF.x, etatICRF.y, etatICRF.z,
                        etatICRF.vx, etatICRF.vy, etatICRF.vz,
                        posSoleilICRF.x, posSoleilICRF.y, posSoleilICRF.z,
                        etatICRF.rayon_km,
                        lat, lon, alt, eraRad, timestampSec,
                        meteo?.tempC ?? 15.0, meteo?.presHpa ?? 1013.25, 0.2,
                        etatICRF.mag, estLune, resultPtr
                    );

                    // Re-lecture dynamique du tampon mémoire à chaque itération
                    const heapF64Current = Module.HEAPF64;
                    const heap32Current = Module.HEAP32;

                    const off = resultPtr / 8;
                    const off32 = resultPtr / 4;
                    const nomAstreMaj = nomAstre.toUpperCase();
                    const shadowVal = heapF64Current[off + 14];
                    const meta = METADATAS_CORPS[nomAstreMaj] || {};

                    const raDeg = heapF64Current[off + 3];
                    const decDeg = heapF64Current[off + 4];

                    bodiesResults[nomAstreMaj] = {
                        azimuth: heapF64Current[off + 0],
                        elevationGeometrique: heapF64Current[off + 1],
                        elevationRefractee: heapF64Current[off + 2],
                        raDeg: raDeg,
                        decDeg: decDeg,
                        distanceAu: heapF64Current[off + 5],
                        sunrise: formaterHeureDecimale(heapF64Current[off + 6]),
                        sunset: formaterHeureDecimale(heapF64Current[off + 7]),
                        airMass: heapF64Current[off + 8],
                        irradiance: heapF64Current[off + 9],
                        deltat: heapF64Current[off + 10],
                        gha: heapF64Current[off + 11],
                        jde: heapF64Current[off + 12],
                        magnitude: heapF64Current[off + 13],
                        shadowLengthDisplay: shadowVal > 0 ? `${shadowVal.toFixed(2)} m` : "Nuit",
                        moonPhasePct: heapF64Current[off + 15],
                        moonAgeDays: heapF64Current[off + 16],
                        dusk: formaterHeureDecimale(heapF64Current[off + 17]),
                        daylightDuration: formaterDureeHeures(heapF64Current[off + 18]),
                        angularDiameterArcsec: heapF64Current[off + 19],
                        surfaceBrightness: heapF64Current[off + 20],
                        illuminatedFractionPct: heapF64Current[off + 21],
                        radialVelocityKmS: heapF64Current[off + 22],
                        visibiliteCode: heap32Current[off32 + 46],
                        seasonCode: heap32Current[off32 + 47],
                        constellationDisplay: determinerConstellation(raDeg, decDeg),
                        distanceMinMaxDisplay: meta.minMax || "--",
                        perigeeDisplay: meta.perigee || "--",
                        perihelionDisplay: meta.perihelion || "--",
                        aphelionDisplay: meta.aphelion || "--",
                        orbitPeriodDisplay: meta.period || "--",
                        lengthOfDayDisplay: meta.lod || "--",
                        orbitalVelocityDisplay: meta.orbitalVel || "--"
                    };
                } catch (astreErr) {
                    postMessage({ type: 'LOG', message: `Erreur de calcul sur ${nomAstre} : ${astreErr.message}` });
                }
            }

            const resWmm = calculerChampingGeomagnetiqueLocal(lat, lon, alt);

            // Correctif clé : Renommage en `metrics` pour alignement direct avec l'interface principale
            postMessage({
                type: 'RESULTS_COMPUTE',
                timestamp: timestampUtc,
                metrics: { eqTempsMin, obliquiteDeg, longSolaireDeg, gastDeg, lstDeg },
                wmm: resWmm,
                bodies: bodiesResults
            });

        } catch (err) {
            postMessage({ type: 'ERROR', message: err.toString() });
        }
    }
};
