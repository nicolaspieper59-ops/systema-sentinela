// ==========================================
// WORKER ASTRONOMIE — KERNEL SENTINELA v18.5
// Intégration analytique pure VSOP2013 & ELP-2000
// ==========================================

// 1. DÉFINITION DE LA CLASSE ORBIT (DOIT IMPÉRATIVEMENT PRÉCÉDER importScripts)
class Orbit {
    constructor(data) {
        if (typeof data === 'object' && data !== null) {
            Object.assign(this, data);
        }
        if (!this.r || typeof this.r !== 'object') {
            this.r = { x: 0, y: 0, z: 0, applyMatrix3: function() {} };
        }
        if (!this.v || typeof this.v !== 'object') {
            this.v = { x: 0, y: 0, z: 0, applyMatrix3: function() {} };
        }
    }

    position(jd) {
        return { x: this.r.x || 0, y: this.r.y || 0, z: this.r.z || 0 };
    }

    state(jd) {
        return {
            r: this.r,
            v: this.v,
            _a: this._a !== undefined ? this._a : (this.a || 0),
            L: () => this.L_val || 0,
            k: () => this.k_val || 0,
            h: () => this.h_val || 0,
            q: () => this.q_val || 0,
            p: () => this.p_val || 0
        };
    }

    _a() { return this.a || 0; }
    L() { return this.L_val || 0; }
    k() { return this.k_val || 0; }
    h() { return this.h_val || 0; }
    q() { return this.q_val || 0; }
    p() { return this.p_val || 0; }
}

// 2. DÉFINITION DE LA FONCTION CYCLE REQUISE PAR LES TABLES
function CYCLE(x) {
    return x - 6.283185307179586 * Math.floor(0.5 * (x * 0.3183098861837907 + 1));
}

// 3. CHARGEMENT DES MODULES DU DÉPÔT
importScripts('vsop2013.js', 'ElpMpp02DE_min.js');

self.postMessage({ type: 'READY', status: 'ANALYTICAL_KERNEL_READY' });

self.onmessage = function(e) {
    const dataMsg = e.data;
    const jd = dataMsg.jd || (dataMsg.data ? dataMsg.data.jd : null);
    const station = dataMsg.station || (dataMsg.data ? { lat: dataMsg.data.lat, lon: dataMsg.data.lon, alt: dataMsg.data.alt } : null);

    if (!jd || !station) return;

    if (dataMsg.type === 'COMPUTE' || dataMsg.type === 'TICK' || dataMsg.command === 'COMPUTE_POSITION') {
        try {
            const results = {};
            const T = (jd - 2451545.0) / 36525.0;

            const earthPos = (typeof vsop2013 !== 'undefined' && vsop2013.ear) 
                ? vsop2013.ear.position(jd) 
                : (vsop2013 && vsop2013.emb ? vsop2013.emb.position(jd) : {x:0, y:0, z:0});

            const planetes = {
                mercure: vsop2013.mer,
                venus: vsop2013.ven,
                mars: vsop2013.mar,
                jupiter: vsop2013.jup,
                saturne: vsop2013.sat,
                uranus: vsop2013.ura,
                neptune: vsop2013.nep
            };

            const soleilGeo = { x: -earthPos.x, y: -earthPos.y, z: -earthPos.z };
            results.soleil = calculerTopocentrique(soleilGeo, jd, station);

            for (const [nom, modulePlanete] of Object.entries(planetes)) {
                if (modulePlanete && typeof modulePlanete.position === 'function') {
                    const pPos = modulePlanete.position(jd);
                    const geoX = pPos.x - earthPos.x;
                    const geoY = pPos.y - earthPos.y;
                    const geoZ = pPos.z - earthPos.z;
                    results[nom] = calculerTopocentrique({ x: geoX, y: geoY, z: geoZ }, jd, station);
                }
            }

            if (typeof getX2000_DE === 'function') {
                const luneState = getX2000_DE(T);
                results.lune = calculerTopocentriqueLune(luneState, jd, station);
            }

            self.postMessage({ type: 'RESULTS', results: results });
        } catch (err) {
            self.postMessage({ type: 'ERROR', message: `Erreur analytique critique dans le worker : ${err.toString()}` });
        }
    }
};

function calculerTopocentrique(geoVec, jd, station) {
    const x = geoVec.x * 149597870.7;
    const y = geoVec.y * 149597870.7;
    const z = geoVec.z * 149597870.7;
    const distanceKm = Math.sqrt(x*x + y*y + z*z);

    const rXY = Math.sqrt(x*x + y*y);
    const declinaisonRad = Math.atan2(z, rXY);
    const ascensionDroiteRad = Math.atan2(y, x);

    const T = (jd - 2451545.0) / 36525.0;
    let gmstDeg = 280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * T * T - (T * T * T) / 38710000.0;
    gmstDeg = (gmstDeg % 360.0 + 360.0) % 360.0;
    const gmstRad = gmstDeg * Math.PI / 180.0;

    const lstRad = gmstRad + (station.lon * Math.PI / 180.0);
    const angleHoraireRad = lstRad - ascensionDroiteRad;

    const latRad = station.lat * Math.PI / 180.0;

    const sinEl = Math.sin(latRad) * Math.sin(declinaisonRad) + Math.cos(latRad) * Math.cos(declinaisonRad) * Math.cos(angleHoraireRad);
    const elevationRad = Math.asin(Math.max(-1, Math.min(1, sinEl)));

    const yAz = -Math.sin(angleHoraireRad);
    const xAz = Math.tan(declinaisonRad) * Math.cos(latRad) - Math.sin(latRad) * Math.cos(angleHoraireRad);
    let azimutRad = Math.atan2(yAz, xAz);
    if (azimutRad < 0) azimutRad += 2 * Math.PI;

    return {
        azimuth: parseFloat((azimutRad * 180.0 / Math.PI).toFixed(2)),
        elevation: parseFloat((elevationRad * 180.0 / Math.PI).toFixed(2)),
        distance: Math.round(distanceKm)
    };
}

function calculerTopocentriqueLune(luneState, jd, station) {
    const x = luneState.x !== undefined ? luneState.x : luneState[0];
    const y = luneState.y !== undefined ? luneState.y : luneState[1];
    const z = luneState.z !== undefined ? luneState.z : luneState[2];
    const distanceKm = Math.sqrt(x*x + y*y + z*z);

    const rXY = Math.sqrt(x*x + y*y);
    const declinaisonRad = Math.atan2(z, rXY);
    const ascensionDroiteRad = Math.atan2(y, x);

    const T = (jd - 2451545.0) / 36525.0;
    let gmstDeg = 280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * T * T - (T * T * T) / 38710000.0;
    gmstDeg = (gmstDeg % 360.0 + 360.0) % 360.0;
    const gmstRad = gmstDeg * Math.PI / 180.0;

    const lstRad = gmstRad + (station.lon * Math.PI / 180.0);
    const angleHoraireRad = lstRad - ascensionDroiteRad;

    const latRad = station.lat * Math.PI / 180.0;

    const sinEl = Math.sin(latRad) * Math.sin(declinaisonRad) + Math.cos(latRad) * Math.cos(declinaisonRad) * Math.cos(angleHoraireRad);
    const elevationRad = Math.asin(Math.max(-1, Math.min(1, sinEl)));

    const yAz = -Math.sin(angleHoraireRad);
    const xAz = Math.tan(declinaisonRad) * Math.cos(latRad) - Math.sin(latRad) * Math.cos(angleHoraireRad);
    let azimutRad = Math.atan2(yAz, xAz);
    if (azimutRad < 0) azimutRad += 2 * Math.PI;

    return {
        azimuth: parseFloat((azimutRad * 180.0 / Math.PI).toFixed(2)),
        elevation: parseFloat((elevationRad * 180.0 / Math.PI).toFixed(2)),
        distance: Math.round(distanceKm)
    };
            }
