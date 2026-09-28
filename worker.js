/**
 * SYSTEMA SENTINELA — WEB WORKER (v20.0 JPL-Grade Complete Engine)
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

function formaterHeureDecimale(heures) {
    if (isNaN(heures) || heures < 0) return "--:-- UTC";
    const h = Math.floor(heures) % 24;
    const m = Math.floor((heures - Math.floor(heures)) * 60);
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
        wasmStatus: "Actif",
        noyauJplCharge: matriceJplGlobal !== null,
        modelesActifs: ["DE440s", "WMM-2025", "Mallama Photometry (2018)", "Diurnal Aberration"]
    };
}

function initialiserMemoireWasm() {
    if (wasmReady && !metricsPtr) {
        metricsPtr = Module._malloc(40);   // 5 x double
        resultPtr = Module._malloc(192);  // AstroResult struct complète (192 bytes)
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

function obtenirEtatParChebyshev(arcsAstre, timestampSec) {
    if (!arcsAstre || arcsAstre.length === 0) {
        throw new Error("Flux d'éphémérides absent.");
    }

    let tEvaluated = timestampSec;
    let arc = arcsAstre.find(a => tEvaluated >= a.t_start && tEvaluated <= a.t_end);

    if (!arc) {
        const premierArc = arcsAstre[0];
        const dernierArc = arcsAstre[arcsAstre.length - 1];
        if (tEvaluated < premierArc.t_start) {
            arc = premierArc;
            tEvaluated = premierArc.t_start;
        } else {
            arc = dernierArc;
            tEvaluated = dernierArc.t_end;
        }
    }

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

onmessage = async function(e) {
    const data = e.data;
    if (!data) return;

    if (data.type === 'UPDATE_JPL_MATRIX') {
        matriceJplGlobal = data.matrix;
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

            const offsetMetrics = metricsPtr / 8;
            const eqTempsMin = Module.HEAPF64[offsetMetrics + 0];
            const obliquiteDeg = Module.HEAPF64[offsetMetrics + 1];
            const longSolaireDeg = Module.HEAPF64[offsetMetrics + 2];
            const gastDeg = Module.HEAPF64[offsetMetrics + 3];
            const lstDeg = Module.HEAPF64[offsetMetrics + 4];

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

                    const off = resultPtr / 8;
                    const nomAstreMaj = nomAstre.toUpperCase();
                    const shadowVal = Module.HEAPF64[off + 14];

                    bodiesResults[nomAstreMaj] = {
                        azimuth: Module.HEAPF64[off + 0],
                        elevationGeometrique: Module.HEAPF64[off + 1],
                        elevationRefractee: Module.HEAPF64[off + 2],
                        raDeg: Module.HEAPF64[off + 3],
                        decDeg: Module.HEAPF64[off + 4],
                        distanceAu: Module.HEAPF64[off + 5],
                        sunrise: formaterHeureDecimale(Module.HEAPF64[off + 6]),
                        sunset: formaterHeureDecimale(Module.HEAPF64[off + 7]),
                        airMass: Module.HEAPF64[off + 8],
                        irradiance: Module.HEAPF64[off + 9],
                        magnitude: Module.HEAPF64[off + 13],
                        shadowLengthDisplay: shadowVal > 0 ? `${shadowVal.toFixed(2)} m` : "Nuit",
                        angularDiameterArcsec: Module.HEAPF64[off + 19],
                        surfaceBrightness: Module.HEAPF64[off + 20],
                        illuminatedFractionPct: Module.HEAPF64[off + 21],
                        radialVelocityKmS: Module.HEAPF64[off + 22]
                    };
                } catch (astreErr) {}
            }

            postMessage({
                type: 'RESULTS_COMPUTE',
                timestamp: timestampUtc,
                solarMetrics: { eqTempsMin, obliquiteDeg, longSolaireDeg, gastDeg, lstDeg },
                bodies: bodiesResults
            });

        } catch (err) {
            postMessage({ type: 'ERROR', message: err.toString() });
        }
    }
};
