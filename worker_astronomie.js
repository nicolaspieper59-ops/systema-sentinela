// worker_astronomie.js — SYSTEMA SENTINELA v14.2 (Version Corrigée)

let fluxLiveCache = null;

const DEG2RAD = Math.PI / 180.0;
const RAD2DEG = 180.0 / Math.PI;

const P0_STD = 1013.25;
const T0_STD = 288.15;

self.onmessage = async function(e) {
    const data = e.data;
    if (data.type === 'COMPUTE') {
        const station = data.station;
        
        try {
            const fluxRecu = data.fluxLive || data.etalonnage;
            if (fluxRecu) {
                fluxLiveCache = fluxRecu;
            }

            if (!fluxLiveCache) {
                return;
            }

            const dateUtc = new Date();
            const { JD, T, annee } = calculerJourJulienPrecis(dateUtc);
            const deltaT = calculerDeltaT(annee);

            const resultats = calculerEphemeridesDepuisFlux(dateUtc, JD, station, fluxLiveCache);
            
            self.postMessage({
                type: 'RESULTS',
                timestamp: dateUtc.toISOString(),
                equations: {
                    deltaT: deltaT,
                    sourceData: "DE440s_TOPOCENTRIQUE_LIVE"
                },
                astres: resultats.astres
            });
        } catch (err) {
            self.postMessage({ type: 'ERROR', message: err.toString() });
        }
    }
};

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
    }
    return 69.0;
}

function calculerERA(JD) {
    const d = JD - 2451545.0;
    const era_tours = (0.7790572732640 + 1.00273781191135448 * d) % 1.0;
    return (era_tours < 0 ? era_tours + 1.0 : era_tours) * 2.0 * Math.PI;
}

function evaluerRefractionISA(altApparenteDeg, tempC = 15, pressionHpa = 1013.25) {
    if (isNaN(altApparenteDeg) || altApparenteDeg < -5.0) {
        return { elevationReelle: altApparenteDeg, refractionArcMinutes: 0 };
    }
    
    const altMin = altApparenteDeg + (10.3 / (altApparenteDeg + 5.1));
    const refStdArcMin = 1.02 / Math.tan(altMin * DEG2RAD);
    const facteurISA = (pressionHpa / P0_STD) * (T0_STD / (tempC + 273.15));
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

    return {
        x: p0.x + (p1.x - p0.x) * fractionMinute,
        y: p0.y + (p1.y - p0.y) * fractionMinute,
        z: p0.z + (p1.z - p0.z) * fractionMinute
    };
}

function itrsVersHorizon(x, y, z, era, latDeg, lonDeg) {
    const latRad = latDeg * DEG2RAD;
    const lonRad = lonDeg * DEG2RAD;
    const ahLocal = era + lonRad;

    const cosLat = Math.cos(latRad);
    const sinLat = Math.sin(latRad);
    const cosAH = Math.cos(ahLocal);
    const sinAH = Math.sin(ahLocal);

    const xEast  = -sinAH * x + cosAH * y;
    const yNorth = -sinLat * cosAH * x - sinLat * sinAH * y + cosLat * z;
    const zUp    =  cosLat * cosAH * x + cosLat * sinAH * y + sinLat * z;

    let az = Math.atan2(xEast, yNorth) * RAD2DEG;
    if (az < 0) az += 360.0;

    const dist3D = Math.sqrt(x * x + y * y + z * z);
    const el = Math.asin(zUp / dist3D) * RAD2DEG;

    return { azimuth: az, elevation: el, distance: dist3D };
}

function calculerEphemeridesDepuisFlux(dateUtc, JD, station, flux) {
    const era = calculerERA(JD);
    const astres = {};
    const matriceDonnees = flux.DATA || flux.jpl || flux;

    if (!matriceDonnees || typeof matriceDonnees !== 'object') {
        throw new Error("Structure du flux d'éphémérides non valide.");
    }

    Object.keys(matriceDonnees).forEach(nomAst => {
        const tableauPositions = matriceDonnees[nomAst];
        if (Array.isArray(tableauPositions) && tableauPositions.length > 0) {
            const posITRS = interpolerVecteurFlux(tableauPositions, dateUtc);
            const posHoriz = itrsVersHorizon(posITRS.x, posITRS.y, posITRS.z, era, station.lat, station.lon);
            const refCor = evaluerRefractionISA(posHoriz.elevation, station.tempC, station.pressionBaro);
            const distKm = posHoriz.distance / 1000.0;

            astres[nomAst] = {
                azimuth: posHoriz.azimuth,
                elevation: refCor.elevationReelle,
                distance: distKm,
                oeilNu: refCor.elevationReelle > 0 ? "OUI" : "NON",
                jumelles: refCor.elevationReelle > -6 ? "OUI" : "NON",
                capteur: "OUI",
                lever: "--:--",
                coucher: "--:--",
                x_itrs: posITRS.x,
                y_itrs: posITRS.y,
                z_itrs: posITRS.z
            };
        }
    });

    return { astres };
        }
