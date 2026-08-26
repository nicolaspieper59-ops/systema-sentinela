// worker_astronomie.js — SYSTEMA SENTINELA v18.6 (Version Corrective Rigoureuse)

let fluxLiveCache = null;

const DEG2RAD = Math.PI / 180.0;
const RAD2DEG = 180.0 / Math.PI;
const P0_STD = 1013.25;
const T0_STD = 288.15;

// Envoi du signal d'initialisation au démarrage
self.postMessage({ type: 'READY', status: 'WASM_READY' });

self.onmessage = async function(e) {
    const data = e.data;
    if (data.type === 'COMPUTE') {
        const station = data.station;
        
        try {
            // Auto-chargement du flux s'il n'est pas fourni dans le message
            if (data.fluxLive) {
                fluxLiveCache = data.fluxLive;
            } else if (!fluxLiveCache) {
                try {
                    const res = await fetch('flux_live.json');
                    if (res.ok) {
                        fluxLiveCache = await res.json();
                    }
                } catch (errFetch) {
                    // Fallback sur structure minimale d'urgence si indisponible
                    fluxLiveCache = null;
                }
            }

            if (!fluxLiveCache) {
                return; // Attente du chargement
            }

            const dateUtc = new Date();
            const { JD, annee } = calculerJourJulienPrecis(dateUtc);
            const deltaT = calculerDeltaT(annee);

            const resultats = calculerEphemeridesDepuisFlux(dateUtc, JD, station, fluxLiveCache);
            
            // Renvoi synchronisé avec la clé 'results' attendue par index.html
            self.postMessage({
                type: 'RESULTS',
                timestamp: dateUtc.toISOString(),
                equations: { deltaT: deltaT, sourceData: "DE440s_TOPOCENTRIQUE_LIVE" },
                results: resultats.astres
            });
        } catch (err) {
            self.postMessage({ type: 'ERROR', message: err.toString() });
        }
    }
};

function calculerJourJulienPrecis(dateUtc) {
    const timeMs = dateUtc.getTime();
    const JD = (timeMs / 86400000.0) + 2440587.5;
    const annee = dateUtc.getUTCFullYear();
    return { JD, annee };
}

function calculerDeltaT(annee) {
    if (annee >= 2015 && annee <= 3000) {
        const t = annee - 2015;
        return 67.62 + 0.3645 * t + 0.0039755 * (t * t);
    }
    return 69.0;
}

function convertirLatLonAltVersECEF(latDeg, lonDeg, altKm) {
    const a = 6378.137; // Rayon équatorial WGS84 en km
    const f = 1.0 / 298.257223563;
    const e2 = f * (2.0 - f);
    
    const phi = latDeg * DEG2RAD;
    const lambda = lonDeg * DEG2RAD;
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    
    const N = a / Math.sqrt(1.0 - e2 * sinPhi * sinPhi);
    
    return {
        x: (N + altKm) * cosPhi * Math.cos(lambda),
        y: (N + altKm) * cosPhi * Math.sin(lambda),
        z: (N * (1.0 - e2) + altKm) * sinPhi
    };
}

function evaluerRefractionISA(altApparenteDeg, tempC = 15, pressionHpa = 1013.25) {
    // Sécurisation contre les valeurs undefined
    const tempSafe = (tempC !== undefined && !isNaN(tempC)) ? tempC : 15;
    const pressSafe = (pressionHpa !== undefined && !isNaN(pressionHpa)) ? pressionHpa : 1013.25;

    if (isNaN(altApparenteDeg) || altApparenteDeg < -5.0) {
        return { elevationReelle: altApparenteDeg, refractionArcMinutes: 0 };
    }
    
    const altMin = altApparenteDeg + (10.3 / (altApparenteDeg + 5.1));
    const refStdArcMin = 1.02 / Math.tan(altMin * DEG2RAD);
    const facteurISA = (pressSafe / P0_STD) * (T0_STD / (tempSafe + 273.15));
    const refMeteoArcMin = refStdArcMin * facteurISA;
    
    return {
        elevationReelle: altApparenteDeg + (refMeteoArcMin / 60.0),
        refractionArcMinutes: refMeteoArcMin
    };
}

function interpolerVecteurFlux(tableau24h, dateUtc) {
    const minuteAujourdhui = dateUtc.getUTCHours() * 60 + dateUtc.getUTCMinutes();
    const secondes = dateUtc.getUTCSeconds() + dateUtc.getUTCMilliseconds() / 1000.0;
    const fractionMinute = secondes / 60.0;

    const idx0 = Math.min(minuteAujourdhui, tableau24h.length - 1);
    const idx1 = Math.min(idx0 + 1, tableau24h.length - 1);

    const p0 = tableau24h[idx0];
    const p1 = tableau24h[idx1];

    if (!p0 || !p1) return { x: 0, y: 0, z: 0 };

    return {
        x: p0.x + (p1.x - p0.x) * fractionMinute,
        y: p0.y + (p1.y - p0.y) * fractionMinute,
        z: p0.z + (p1.z - p0.z) * fractionMinute
    };
}

function itrsTopocentriqueVersHorizon(xAstre, yAstre, zAstre, station) {
    // 1. Calcul des coordonnées ECEF de la station (en km)
    const stECEF = convertirLatLonAltVersECEF(station.lat, station.lon, station.alt);

    // 2. Vecteur relatif Topocentrique (Astre - Station)
    const dx = xAstre - stECEF.x;
    const dy = yAstre - stECEF.y;
    const dz = zAstre - stECEF.z;

    // 3. Transformation en repère local ENU (East-North-Up)
    const latRad = station.lat * DEG2RAD;
    const lonRad = station.lon * DEG2RAD;

    const sinLat = Math.sin(latRad);
    const cosLat = Math.cos(latRad);
    const sinLon = Math.sin(lonRad);
    const cosLon = Math.cos(lonRad);

    const xEast  = -sinLon * dx + cosLon * dy;
    const yNorth = -sinLat * cosLon * dx - sinLat * sinLon * dy + cosLat * dz;
    const zUp    =  cosLat * cosLon * dx + cosLat * sinLon * dy + sinLat * dz;

    let az = Math.atan2(xEast, yNorth) * RAD2DEG;
    if (az < 0) az += 360.0;

    const dist3D = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const el = Math.asin(zUp / dist3D) * RAD2DEG;

    return { azimuth: az, elevation: el, distance: dist3D };
}

function calculerEphemeridesDepuisFlux(dateUtc, JD, station, flux) {
    const astres = {};
    const matriceDonnees = flux.DATA || flux.jpl || flux;

    if (!matriceDonnees || typeof matriceDonnees !== 'object') {
        throw new Error("Structure du flux d'éphémérides invalide.");
    }

    Object.keys(matriceDonnees).forEach(nomAst => {
        const tableauPositions = matriceDonnees[nomAst];
        if (Array.isArray(tableauPositions) && tableauPositions.length > 0) {
            const posITRS = interpolerVecteurFlux(tableauPositions, dateUtc);
            const posHoriz = itrsTopocentriqueVersHorizon(posITRS.x, posITRS.y, posITRS.z, station);
            const refCor = evaluerRefractionISA(posHoriz.elevation, station.tempC, station.pressionBaro);

            astres[nomAst] = {
                azimuth: posHoriz.azimuth,
                elevation: refCor.elevationReelle,
                distance: posHoriz.distance,
                oeilNu: refCor.elevationReelle > 0 ? "OUI" : "NON",
                jumelles: refCor.elevationReelle > -6 ? "OUI" : "NON",
                capteur: "OUI",
                x_itrs: posITRS.x,
                y_itrs: posITRS.y,
                z_itrs: posITRS.z
            };
        }
    });

    return { astres };
        }
