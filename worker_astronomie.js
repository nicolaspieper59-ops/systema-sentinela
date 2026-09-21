/**
 * ============================================================================
 * SYSTEMA SENTINELA — WEB WORKER ASTRONOMIE & GÉOMAGNÉTISME (WASM)
 * Version v19.3 — Alignement strict avec l'interface HTML
 * ============================================================================
 */

var Module = {
    onRuntimeInitialized: function() {
        wasmReady = true;
        initialiserMemoireWasm();
        // Notification conforme à la fonction traiterMessageWorker() du HTML
        postMessage({ type: 'WORKER_READY' });
    }
};

let wasmReady = false;
let matriceJplGlobal = null;
let wmmCoefficients = null;

let metricsPtr = 0;
let resultPtr = 0;

importScripts('wasm_astronomie.js');

function initialiserMemoireWasm() {
    if (wasmReady && !metricsPtr) {
        metricsPtr = Module._malloc(40); // 5 x double (64-bit)
        resultPtr = Module._malloc(96);  // Tampon de structure AstroResult
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
    return (coeffs[0] * 0.5) + x * bK1 - bK2;
}

function obtenirPositionParChebyshev(arcsAstre, timestampSec) {
    if (!arcsAstre || arcsAstre.length === 0) return null;
    let arc = arcsAstre.find(a => timestampSec >= a.t_start && timestampSec <= a.t_end);
    if (!arc) {
        arc = (timestampSec < arcsAstre[0].t_start) ? arcsAstre[0] : arcsAstre[arcsAstre.length - 1];
    }
    const tMin = arc.t_start, tMax = arc.t_end;
    const tNorm = (tMin === tMax) ? 0.0 : (2.0 * (timestampSec - tMin) / (tMax - tMin) - 1.0);

    return {
        x: evaluerClenshawChebyshev(arc.cx, tNorm),
        y: evaluerClenshawChebyshev(arc.cy, tNorm),
        z: evaluerClenshawChebyshev(arc.cz, tNorm),
        mag: arc.mag ?? 0.0
    };
}

function parserFichierWMM(texte) {
    const lignes = texte.split(/\r?\n/);
    const coeffs = [];
    for (let ligne of lignes) {
        const elements = ligne.trim().split(/\s+/);
        if (elements.length >= 6) {
            const n = parseInt(elements[0], 10), m = parseInt(elements[1], 10);
            const g = parseFloat(elements[2]), h = parseFloat(elements[3]);
            const dtg = parseFloat(elements[4]), dth = parseFloat(elements[5]);
            if (!isNaN(n) && !isNaN(m) && !isNaN(g) && !isNaN(h)) {
                coeffs.push({ n, m, g, h, dtg, dth });
            }
        }
    }
    return coeffs;
}

function calculerWmmDynamique(latDeg, lonDeg, altKm, anneeDecimale) {
    if (!wmmCoefficients || wmmCoefficients.length === 0) {
        throw new Error("Coefficients WMM non chargés.");
    }

    const a = 6378.137;          
    const b = 6356.7523142;      
    const alt = Math.max(0, altKm);
    
    const latRad = latDeg * (Math.PI / 180.0);
    const lonRad = lonDeg * (Math.PI / 180.0);

    const cosLat = Math.cos(latRad);
    const sinLat = Math.sin(latRad);
    const e2 = (a * a - b * b) / (a * a);
    
    const N = a / Math.sqrt(1.0 - e2 * sinLat * sinLat);
    const r = Math.sqrt((N * cosLat + alt * cosLat) ** 2 + ((N * (1.0 - e2) + alt) * sinLat) ** 2);
    
    const theta = Math.asin(Math.max(-1.0, Math.min(1.0, ((N * (1.0 - e2) + alt) * sinLat) / r)));
    const colat = (Math.PI / 2.0) - theta;

    const dt = anneeDecimale - 2025.0;
    const a_r = 6371.2; 

    let Br = 0.0, Btheta = 0.0, Bphi = 0.0;
    const maxN = 12;

    const P = Array(maxN + 2).fill(0).map(() => Array(maxN + 2).fill(0));
    const dP = Array(maxN + 2).fill(0).map(() => Array(maxN + 2).fill(0));

    P[0][0] = 1.0;
    dP[0][0] = 0.0;

    const sinColat = Math.sin(colat);
    const cosColat = Math.cos(colat);

    for (let n = 1; n <= maxN; n++) {
        for (let m = 0; m <= n; m++) {
            if (n === m) {
                P[n][n] = sinColat * P[n - 1][n - 1];
                dP[n][n] = sinColat * dP[n - 1][n - 1] + cosColat * P[n - 1][n - 1];
            } else if (n === 1 && m === 0) {
                P[1][0] = cosColat * P[0][0];
                dP[1][0] = -sinColat * P[0][0];
            } else if (n > 1 && n !== m) {
                let k = (((n - 1) * (n - 1)) - (m * m)) / (((2 * n - 1) * (2 * n - 3)));
                P[n][m] = cosColat * P[n - 1][m] - Math.sqrt(k) * P[n - 2][m];
                dP[n][m] = cosColat * dP[n - 1][m] - sinColat * P[n - 1][m] - Math.sqrt(k) * dP[n - 2][m];
            }
        }
    }

    for (let c of wmmCoefficients) {
        const n = c.n;
        const m = c.m;
        if (n > maxN) continue;

        const g = c.g + dt * c.dtg;
        const h = c.h + dt * c.dth;

        const ratio = Math.pow(a_r / r, n + 2);
        const cosM = Math.cos(m * lonRad);
        const sinM = Math.sin(m * lonRad);

        const term = ratio * (g * cosM + h * sinM);

        Br += (n + 1) * term * P[n][m];
        if (sinColat > 1e-15) {
            Btheta -= term * dP[n][m];
        }
        if (m > 0) {
            const termPhi = ratio * m * (-g * sinM + h * cosM);
            Bphi += termPhi * P[n][m] / sinColat;
        }
    }

    const psi = latRad - theta;
    const X = -Btheta * Math.cos(psi) - Br * Math.sin(psi);
    const Y = Bphi;
    const Z = -Btheta * Math.sin(psi) + Br * Math.cos(psi);

    const hHoriz = Math.sqrt(X * X + Y * Y);
    const totalIntensity = Math.sqrt(hHoriz * hHoriz + Z * Z);
    
    return {
        declination: Math.atan2(Y, X) * (180.0 / Math.PI),
        inclination: Math.atan2(Z, hHoriz) * (180.0 / Math.PI),
        totalIntensity: totalIntensity
    };
}

function formaterHeureDecimale(decHours) {
    const h = Math.floor(decHours), m = Math.floor((decHours - h) * 60);
    const s = Math.floor(((decHours - h) * 60 - m) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

onmessage = async function(e) {
    const data = e.data;
    if (!data) return;

    if (data.type === 'UPDATE_JPL_MATRIX') {
        matriceJplGlobal = data.matrix;
        return;
    }

    if (data.type === 'INIT_WMM') {
        try {
            if (data.cofText) wmmCoefficients = parserFichierWMM(data.cofText);
            const coords = data.coords || { lat: 43.2843, lon: 5.3585, alt: 10 };
            const resultat = calculerWmmDynamique(coords.lat, coords.lon, coords.alt / 1000.0, 2026.2);
            postMessage({ type: 'WMM_RESULTS', payload: resultat });
        } catch (err) {
            postMessage({ type: 'ERROR', message: "Erreur WMM : " + err.toString() });
        }
        return;
    }

    if (data.type === 'COMPUTE') {
        if (!wasmReady) {
            postMessage({ type: 'ERROR', message: "Module WASM non prêt." });
            return;
        }

        initialiserMemoireWasm();

        try {
            const { timestampUtc, coords, meteo } = data;
            const { lat, lon, alt } = coords;
            const meteoDefaut = matriceJplGlobal?.METEO_DEFAUT || { tempC: 15.0, presHpa: 1013.25 };
            const tempC = meteo?.tempC ?? meteoDefaut.tempC;
            const presHpa = meteo?.presHpa ?? meteoDefaut.presHpa;
            const timestampSec = timestampUtc / 1000.0;

            // Execution WASM des paramètres solaires et sidéraux
            Module._calculerParametresSiderauxEtSolaires(timestampSec, lon, metricsPtr);

            const offset = metricsPtr / 8;
            const eqTempsMin = Module.HEAPF64[offset + 0];
            const obliquiteDeg = Module.HEAPF64[offset + 1];
            const longSolaireDeg = Module.HEAPF64[offset + 2];
            const gastDeg = Module.HEAPF64[offset + 3];
            const lstDeg = Module.HEAPF64[offset + 4];

            const solarMetrics = {
                eqTempsMin,
                obliquiteDeg,
                longSolaireDeg,
                gastDeg,
                lstDeg,
                excentricite: 0.01671022
            };

            const eraRad = (gastDeg % 360.0) * (Math.PI / 180.0);
            const bodiesResults = {};
            const sourceDonnees = matriceJplGlobal?.DATA || null;
            const corpsACalculer = {};

            if (sourceDonnees) {
                for (const [nomAstre, arcsAstre] of Object.entries(sourceDonnees)) {
                    const pos = obtenirPositionParChebyshev(arcsAstre, timestampSec);
                    if (pos) corpsACalculer[nomAstre] = pos;
                }
            }

            for (const [nomAstre, coordsEcl] of Object.entries(corpsACalculer)) {
                try {
                    Module._calculerDepuisECEF(
                        coordsEcl.x, coordsEcl.y, coordsEcl.z,
                        lat, lon, alt, eraRad, timestampSec, tempC, presHpa, coordsEcl.mag, true, resultPtr
                    );

                    const resOffset = resultPtr / 8;
                    const decDeg = Module.HEAPF64[resOffset + 4];
                    const raDeg = Module.HEAPF64[resOffset + 3];
                    const distanceAU = Module.HEAPF64[resOffset + 5]; // Valeur native en Unités Astronomiques

                    bodiesResults[nomAstre] = {
                        azimuth: Module.HEAPF64[resOffset + 0],
                        elevationGeometrique: Module.HEAPF64[resOffset + 1],
                        elevationRefractee: Module.HEAPF64[resOffset + 2],
                        raDeg: raDeg,
                        decDeg: decDeg,
                        distanceAu: distanceAU,
                        magnitude: coordsEcl.mag,
                        airMass: Module.HEAPF64[resOffset + 8],
                        irradiance: Module.HEAPF64[resOffset + 9],
                        deltaT: Module.HEAPF64[resOffset + 10],
                        visibiliteCode: Module.HEAP32[(resultPtr + 88) / 4]
                    };
                } catch (errAstre) {
                    console.warn(`[Worker] Erreur calcul ${nomAstre}:`, errAstre);
                }
            }

            // Retour structuré conforme aux attentes directes de l'interface HTML
            postMessage({
                type: 'RESULTS_COMPUTE',
                timestamp: timestampUtc,
                solarMetrics,
                tempsJpl: { gastDeg, lstDeg },
                bodies: bodiesResults
            });

        } catch (err) {
            postMessage({ type: 'ERROR', message: err.toString() });
        }
    }
};
