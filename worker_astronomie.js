// worker_astronomie.js
importScripts('vsop2013.js', 'ElpMpp02LLR_min.js');

let etalonnageActif = {};

// Constantes ISA & Astrodynamiques WGS84
const P0_STD = 1013.25;
const T0_STD = 288.15;
const L_LAPSE = 0.0065;
const R_AIR = 287.05;
const G_ACC = 9.80665;
const DEG2RAD = Math.PI / 180.0;
const RAD2DEG = 180.0 / Math.PI;

// Ellipsoïde WGS84 pour la parallaxe topocentrique exacte
const WGS84_A = 6378.137;         // Rayon équatorial en km
const WGS84_F = 1.0 / 298.257223563; // Aplatissement
const WGS84_B = WGS84_A * (1.0 - WGS84_F);

self.onmessage = async function(e) {
    const data = e.data;
    if (data.type === 'COMPUTE') {
        const station = data.station;
        if (data.etalonnage) etalonnageActif = data.etalonnage;
        
        try {
            // Repli transparent sur l'horloge interne si réseau indisponible (Mode Hors-Ligne)
            const dateUtc = await obtenirTempsUTC(data.forceReseau);
            const { JD, T, annee } = calculerJourJulienPrecis(dateUtc);
            const deltaT = calculerDeltaT(annee);
            const altFusionnee = fusionnerAltitudeBrute(station.altGps, station.pressionBaro, station.baroActif);

            const resultats = calculerEphemeridesCompletes(dateUtc, JD, T, deltaT, station, altFusionnee, etalonnageActif);
            
            self.postMessage({
                type: 'RESULTS',
                equations: resultats.equations,
                astres: resultats.astres
            });
        } catch (err) {
            self.postMessage({ type: 'ERROR', message: err.toString() });
        }
    }
};

/**
 * Algorithme de Clenshaw simultané (Position + Vitesse)
 */
function evaluerChebyshevEtDerivee(tJulian, tStart, tEnd, coeffs) {
    const N = coeffs.length;
    if (N === 0) return { val: 0, vel: 0 };

    const tau = (2.0 * tJulian - (tStart + tEnd)) / (tEnd - tStart);
    const tauBorne = Math.max(-1.0, Math.min(1.0, tau));
    const u = 2.0 * tauBorne;
    
    let b2 = 0.0, b1 = 0.0, b0 = 0.0;
    let d2 = 0.0, d1 = 0.0, d0 = 0.0;

    for (let i = N - 1; i >= 1; i--) {
        b0 = coeffs[i] + u * b1 - b2;
        d0 = 2.0 * b1 + u * d1 - d2;
        b2 = b1; b1 = b0;
        d2 = d1; d1 = d0;
    }

    const position = coeffs[0] + tauBorne * b1 - b2;
    const dVal_dTau = b1 + tauBorne * d1 - d2;
    const dTau_dt = 2.0 / (tEnd - tStart);
    const vitesse = dVal_dTau * dTau_dt;

    return { val: position, vel: vitesse };
}

function evaluerVecteurEtat3D(tJulian, troncon) {
    const resX = evaluerChebyshevEtDerivee(tJulian, troncon.tStart, troncon.tEnd, troncon.coeffsX);
    const resY = evaluerChebyshevEtDerivee(tJulian, troncon.tStart, troncon.tEnd, troncon.coeffsY);
    const resZ = evaluerChebyshevEtDerivee(tJulian, troncon.tStart, troncon.tEnd, troncon.coeffsZ);

    return {
        pos: { x: resX.val, y: resY.val, z: resZ.val },
        vel: { 
            vx: resX.vel / 86400.0,
            vy: resY.vel / 86400.0,
            vz: resZ.vel / 86400.0
        }
    };
}

async function obtenirTempsUTC(forceReseau = false) {
    if (forceReseau && navigator.onLine) {
        try {
            const reponse = await fetch('https://worldtimeapi.org/api/timezone/Etc/UTC', { cache: 'no-store' });
            if (reponse.ok) {
                const data = await reponse.json();
                return new Date(data.unixtime * 1000);
            }
        } catch (e) {
            // Mode déconnecté : poursuite silencieuse sur l'horloge système
        }
    }
    return new Date();
}

function calculerJourJulienPrecis(dateUtc) {
    const timeMs = dateUtc.getTime();
    const JD = (timeMs / 86400000.0) + 2440587.5;
    const T = (JD - 2451545.0) / 36525.0;
    const annee = dateUtc.getUTCFullYear();
    return { JD, T, annee };
}

function calculerDeltaT(annee) {
    if (annee >= 2015 && annee <= 3000) {
        const t = annee - 2015;
        return 67.62 + 0.3645 * t + 0.0039755 * (t * t);
    } else if (annee >= 2005 && annee < 2015) {
        const t = annee - 2005;
        return 64.69 + 0.2930 * t;
    }
    return 69.0;
}

function fusionnerAltitudeBrute(altGpsKm, pressionHpa, baroActif) {
    const altGpsM = (altGpsKm || 0) * 1000.0;
    if (baroActif && pressionHpa > 0) {
        const altBaroM = (T0_STD / L_LAPSE) * (1.0 - Math.pow(pressionHpa / P0_STD, (R_AIR * L_LAPSE) / G_ACC));
        return { altM: altBaroM, altKm: altBaroM / 1000.0, source: "BAROMETRE_BRUT" };
    }
    return { altM: altGpsM, altKm: altGpsM / 1000.0, source: "GPS_BRUT" };
}

/**
 * Calcul de la position 3D de l'observateur en coordonnées géocentriques (WGS84)
 */
function calculerVecteurObservateurWGS84(latDeg, lonDeg, altM) {
    const latRad = latDeg * DEG2RAD;
    const lonRad = lonDeg * DEG2RAD;
    const altKm = altM / 1000.0;

    const e2 = 1.0 - (WGS84_B * WGS84_B) / (WGS84_A * WGS84_A);
    const N = WGS84_A / Math.sqrt(1.0 - e2 * Math.sin(latRad) * Math.sin(latRad));

    return {
        x: (N + altKm) * Math.cos(latRad) * Math.cos(lonRad),
        y: (N + altKm) * Math.cos(latRad) * Math.sin(lonRad),
        z: (N * (1.0 - e2) + altKm) * Math.sin(latRad)
    };
}

function calculerGST(JD) {
    const d = JD - 2451545.0;
    let gst = 280.46061837 + 360.98564736629 * d;
    gst = (gst % 360 + 360) % 360;
    return gst * DEG2RAD;
}

function evaluerRefractionISA(altApparenteDeg, tempC, pressionHpa, humPct) {
    if (isNaN(altApparenteDeg) || altApparenteDeg < -5.0) {
        return { elevationReelle: altApparenteDeg, refractionArcMinutes: 0 };
    }
    
    const altMin = altApparenteDeg + (10.3 / (altApparenteDeg + 5.1));
    const refStdArcMin = 1.02 / Math.tan(altMin * DEG2RAD);
    
    const tempK = tempC + 273.15;
    const eSat = 6.1121 * Math.exp((17.502 * tempC) / (240.97 + tempC));
    const eVapeur = (humPct / 100.0) * eSat;
    const pEffective = pressionHpa - 0.1507 * eVapeur;

    const facteurISA = (pEffective / P0_STD) * (T0_STD / tempK);
    const refMeteoArcMin = refStdArcMin * facteurISA;
    
    return {
        elevationReelle: altApparenteDeg - (refMeteoArcMin / 60.0),
        refractionArcMinutes: refMeteoArcMin
    };
}

function calculerEphemeridesCompletes(dateUtc, JD, T, deltaT, station, altFusionnee, calibration) {
    const lonSolaireApprox = (280.460 + 360.00769 * (JD - 2451545.0)) % 360;
    const eqTempsVal = -1.9 * Math.sin(lonSolaireApprox * DEG2RAD) + 9.8 * Math.sin(2 * lonSolaireApprox * DEG2RAD);

    const equations = {
        eqTemps: eqTempsVal + (calibration.eqTemps || 0),
        excentricite: 0.0167086 - 0.00004200 * T,
        obliquite: 23.43929 - 0.0130042 * T,
        lonSolaire: (lonSolaireApprox + 360) % 360,
        deltaT: deltaT,
        altitudeSource: altFusionnee.source
    };

    const gst = calculerGST(JD);
    const latRad = station.lat * DEG2RAD;
    const lonRad = station.lon * DEG2RAD;
    const lst = gst + lonRad;

    // Vecteur observateur WGS84 pour la parallaxe
    const rObs = calculerVecteurObservateurWGS84(station.lat, station.lon, altFusionnee.altM);

    const astres = {};

    // 1. Lune (ELP/LLR) avec parallaxe topocentrique
    try {
        if (typeof getX2000_LLR === 'function') {
            const luneXYZ = getX2000_LLR(T);
            
            // Correction de parallaxe : Passage Géocentrique -> Topocentrique
            const luneTopocentrique = {
                x: luneXYZ.X - rObs.x,
                y: luneXYZ.Y - rObs.y,
                z: luneXYZ.Z - rObs.z
            };

            const rLune = Math.sqrt(luneTopocentrique.x**2 + luneTopocentrique.y**2 + luneTopocentrique.z**2);
            const azEl = vecteurVersHorizon(luneTopocentrique.x, luneTopocentrique.y, luneTopocentrique.z, lst, latRad);
            const refCor = evaluerRefractionISA(azEl.elevation, station.tempC, station.pressionBaro, station.humPct);

            astres["Lune"] = {
                azimuth: azEl.azimuth,
                elevation: refCor.elevationReelle,
                oeilNu: "OUI", jumelles: "OUI", capteur: "ACTIF",
                distance: rLune
            };
        }
    } catch (e) {
        astres["Lune"] = { azimuth: 0, elevation: 0, oeilNu: "ERREUR", distance: 0 };
    }

    // 2. Évaluation des tronçons Chebyshev (VSOP2013 / DE440s)
    if (typeof obtenirTronconChebyshev === 'function') {
        const corps = ["Soleil", "Mars", "Venus"];
        
        corps.forEach(nomAst => {
            const troncon = obtenirTronconChebyshev(nomAst, JD);
            if (troncon) {
                const etat3D = evaluerVecteurEtat3D(JD, troncon);

                // Application de la parallaxe topocentrique
                const posTopo = {
                    x: etat3D.pos.x - rObs.x,
                    y: etat3D.pos.y - rObs.y,
                    z: etat3D.pos.z - rObs.z
                };

                const azEl = vecteurVersHorizon(posTopo.x, posTopo.y, posTopo.z, lst, latRad);
                const refCor = evaluerRefractionISA(azEl.elevation, station.tempC, station.pressionBaro, station.humPct);
                const vNorm = Math.sqrt(etat3D.vel.vx**2 + etat3D.vel.vy**2 + etat3D.vel.vz**2);

                astres[nomAst] = {
                    azimuth: azEl.azimuth,
                    elevation: refCor.elevationReelle,
                    position: posTopo,
                    vitesse: etat3D.vel,
                    vitesseNorme: vNorm,
                    oeilNu: nomAst === "Soleil" ? "NON" : "OUI",
                    jumelles: "OUI",
                    capteur: "ACTIF"
                };
            }
        });
    }

    return { equations, astres };
}

function vecteurVersHorizon(x, y, z, lst, lat) {
    const cosLat = Math.cos(lat), sinLat = Math.sin(lat);
    const cosLST = Math.cos(lst), sinLST = Math.sin(lst);

    // Transformation en repère local SEU (Sud, Est, Zenith)
    const xEast  = -sinLST * x + cosLST * y;
    const yNorth = -sinLat * cosLST * x - sinLat * sinLST * y + cosLat * z;
    const zUp    =  cosLat * cosLST * x + cosLat * sinLST * y + sinLat * z;

    let az = Math.atan2(-xEast, yNorth) * RAD2DEG;
    if (az < 0) az += 360;

    const el = Math.atan2(zUp, Math.sqrt(xEast**2 + yNorth**2)) * RAD2DEG;
    return { azimuth: az, elevation: el };
                              }
