/**
 * SYSTEMA SENTINELA — WEB WORKER (v19.12 REAL-TIME WITH BOUNDARY PROTECTION)
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
let wmmCoeffs = null;

const VITESSE_LUMIERE_KM_S = 299792.458;

importScripts('wasm_astronomie.js');

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
        memoireAlloueeBytes: 33554432,
        noyauJplCharge: matriceJplGlobal !== null,
        modelesActifs: ["DE440s", "EGM2008", "WMM-2025", "US Standard Atmosphere"]
    };
}

function initialiserMemoireWasm() {
    if (wasmReady && !metricsPtr) {
        metricsPtr = Module._malloc(40);   // 5 x double (8 octets)
        resultPtr = Module._malloc(168);  // AstroResult struct
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

function obtenirPositionParChebyshev(arcsAstre, timestampSec, autoriserClamping = true) {
    if (!arcsAstre || arcsAstre.length === 0) {
        throw new Error("Flux d'éphémérides absent ou invalide.");
    }

    let tEvaluated = timestampSec;
    let arc = arcsAstre.find(a => tEvaluated >= a.t_start && tEvaluated <= a.t_end);

    if (!arc) {
        if (!autoriserClamping) {
            throw new Error(`Timestamp UTC ${timestampSec} hors plage du flux d'éphémérides JPL live.`);
        }

        const premierArc = arcsAstre[0];
        const dernierArc = arcsAstre[arcsAstre.length - 1];

        if (tEvaluated < premierArc.t_start) {
            arc = premierArc;
            tEvaluated = premierArc.t_start;
        } else if (tEvaluated > dernierArc.t_end) {
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
        mag: arc.mag ?? 0.0
    };
}

function chargerCoefficientsWMM(contenuCof) {
    const lignes = contenuCof.split('\n');
    const coeffs = [];
    for (let line of lignes) {
        line = line.trim();
        if (!line || line.startsWith('#')) continue;
        const p = line.split(/\s+/);
        if (p.length >= 6) {
            coeffs.push({
                n: parseInt(p[0]),
                m: parseInt(p[1]),
                g: parseFloat(p[2]),
                h: parseFloat(p[3]),
                dg: parseFloat(p[4]),
                dh: parseFloat(p[5])
            });
        }
    }
    return coeffs;
}

function calculerChampMagnetiqueWMM(latDeg, lonDeg, altMeters, timestampSec) {
    if (!wmmCoeffs || wmmCoeffs.length === 0) {
        throw new Error("Modèle géomagnétique WMM-2025 non chargé.");
    }

    const anneeFrac = 2025.0 + ((timestampSec - 1735689600) / 31557600.0);
    const dt = anneeFrac - 2025.0;

    const rad = Math.PI / 180.0;
    const phi = latDeg * rad;
    const lambda = lonDeg * rad;
    const r = 6371.2 + (altMeters / 1000.0);
    const a = 6371.2;

    let X = 0, Y = 0, Z = 0;

    for (const c of wmmCoeffs) {
        const g = c.g + c.dg * dt;
        const h = c.h + c.dh * dt;
        const factor = Math.pow(a / r, c.n + 2);

        const cosML = Math.cos(c.m * lambda);
        const sinML = Math.sin(c.m * lambda);

        X += factor * (g * cosML + h * sinML) * Math.cos(phi);
        Y += factor * (g * sinML - h * cosML) * Math.sin(phi);
        Z -= (c.n + 1) * factor * (g * cosML + h * sinML) * Math.sin(phi);
    }

    const H = Math.sqrt(X * X + Y * Y);
    const F = Math.sqrt(H * H + Z * Z);
    const D = Math.atan2(Y, X) * (180.0 / Math.PI);
    const I = Math.atan2(Z, H) * (180.0 / Math.PI);

    return { declination: D, inclination: I, totalIntensity: F };
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
            wmmCoeffs = chargerCoefficientsWMM(data.contenu);
            postMessage({ type: 'WMM_LOADED' });
        } catch (err) {
            postMessage({ type: 'ERROR', message: `Échec chargement WMM : ${err.message}` });
        }
        return;
    }

    if (data.type === 'COMPUTE') {
        if (!wasmReady) {
            postMessage({ type: 'ERROR', message: 'Noyau Wasm non initialisé' });
            return;
        }
        if (!matriceJplGlobal || !matriceJplGlobal.DATA) {
            postMessage({ type: 'ERROR', message: 'Matrice d\'éphémérides JPL non chargée.' });
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

            let posSoleilECEF = { x: 0, y: 0, z: 0 };
            if (sourceDonnees['SOLEIL']) {
                posSoleilECEF = obtenirPositionParChebyshev(sourceDonnees['SOLEIL'], timestampSec, true);
            }

            for (const [nomAstre, arcsAstre] of Object.entries(sourceDonnees)) {
                try {
                    const posBrute = obtenirPositionParChebyshev(arcsAstre, timestampSec, true);
                    const distanceKm = Math.sqrt(posBrute.x ** 2 + posBrute.y ** 2 + posBrute.z ** 2);
                    
                    const tempsPropagationSec = distanceKm / VITESSE_LUMIERE_KM_S;
                    const timestampRetarde = timestampSec - tempsPropagationSec;

                    const posECEF = obtenirPositionParChebyshev(arcsAstre, timestampRetarde, true);
                    const estLune = (nomAstre.toUpperCase() === 'LUNE');

                    Module._calculerDepuisECEF(
                        posECEF.x, posECEF.y, posECEF.z,
                        posSoleilECEF.x, posSoleilECEF.y, posSoleilECEF.z,
                        lat, lon, alt, eraRad, timestampSec,
                        meteo?.tempC ?? 15.0, meteo?.presHpa ?? 1013.25, 0.2,
                        posECEF.mag, estLune, resultPtr
                    );

                    const off = resultPtr / 8;
                    const nomAstreMaj = nomAstre.toUpperCase();

                    const raVal = Module.HEAPF64[off + 3];
                    const decVal = Module.HEAPF64[off + 4];
                    const constObj = obtenirConstellationIAU(raVal, decVal);
                    const shadowVal = Module.HEAPF64[off + 14];

                    bodiesResults[nomAstreMaj] = {
                        azimuth: Module.HEAPF64[off + 0],
                        elevationGeometrique: Module.HEAPF64[off + 1],
                        elevationRefractee: Module.HEAPF64[off + 2],
                        elevationApparente: Module.HEAPF64[off + 2],
                        elevation: Module.HEAPF64[off + 2],
                        raDeg: raVal,
                        decDeg: decVal,
                        distanceAu: Module.HEAPF64[off + 5],
                        magnitude: Module.HEAPF64[off + 13],
                        sunrise: formaterHeureDecimale(Module.HEAPF64[off + 6]),
                        sunset: formaterHeureDecimale(Module.HEAPF64[off + 7]),
                        dusk: formaterHeureDecimale(Module.HEAPF64[off + 17]),
                        daylightDuration: formaterDureeHeures(Module.HEAPF64[off + 18]),
                        airMass: Module.HEAPF64[off + 8],
                        irradiance: Module.HEAPF64[off + 9],
                        deltat: Module.HEAPF64[off + 10],
                        gha: Module.HEAPF64[off + 11],
                        jde: Module.HEAPF64[off + 12],
                        shadowLength: shadowVal > 0 ? shadowVal : 0,
                        shadowLengthDisplay: shadowVal > 0 ? `${shadowVal.toFixed(2)} m` : "Aucune (Nuit)",
                        moonPhasePct: Module.HEAPF64[off + 15],
                        moonAgeDays: Module.HEAPF64[off + 16],
                        visibiliteCode: Module.HEAP32[(resultPtr + 152) / 4],
                        constellationCode: constObj.code,
                        constellationNom: constObj.nom,
                        constellationDisplay: `${constObj.code} (${constObj.nom})`
                    };
                } catch (astreErr) {
                    // Isolation d'une erreur sur un corps céleste particulier
                }
            }

            let calculWmm = null;
            if (wmmCoeffs) {
                calculWmm = calculerChampMagnetiqueWMM(lat, lon, alt, timestampSec);
            }

            postMessage({
                type: 'RESULTS_COMPUTE',
                timestamp: timestampUtc,
                almanac: matriceJplGlobal.ALMANACH ?? null,
                solarMetrics: { 
                    eqTempsMin, 
                    obliquiteDeg, 
                    longSolaireDeg, 
                    gastDeg, 
                    lstDeg 
                },
                wmm: calculWmm,
                bodies: bodiesResults
            });

        } catch (err) {
            postMessage({ type: 'ERROR', message: err.toString() });
        }
    }
};
