// ==========================================
// WORKER ASTRONOMIE — KERNEL SENTINELA v18.5
// Intégration analytique pure VSOP2013 & ELP-2000
// ==========================================

// Définition rigoureuse de la classe Orbit exigée par vsop2013.js
class Orbit {
    constructor(data) {
        if (typeof data === 'object' && data !== null) {
            Object.assign(this, data);
        }
        // S'assurer que les vecteurs r et v existent et possèdent des méthodes de repli 
        // pour éviter tout plantage si applyMatrix3 est appelé en interne.
        if (!this.r || typeof this.r.applyMatrix3 !== 'function') {
            this.r = {
                x: this.r ? (this.r.x || 0) : 0,
                y: this.r ? (this.r.y || 0) : 0,
                z: this.r ? (this.r.z || 0) : 0,
                applyMatrix3: function() {}
            };
        }
        if (!this.v || typeof this.v.applyMatrix3 !== 'function') {
            this.v = {
                x: this.v ? (this.v.x || 0) : 0,
                y: this.v ? (this.v.y || 0) : 0,
                z: this.v ? (this.v.z || 0) : 0,
                applyMatrix3: function() {}
            };
        }
    }

    // Méthode standard de position
    position(jd) {
        return { x: this.r.x, y: this.r.y, z: this.r.z };
    }

    // Méthode .state() appelée de manière critique par vsop2013.js sur les valeurs intermédiaires
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

    // Accesseurs orbitaux requis par la désérialisation interne de vsop2013
    _a() { return this.a || 0; }
    L() { return this.L_val || 0; }
    k() { return this.k_val || 0; }
    h() { return this.h_val || 0; }
    q() { return this.q_val || 0; }
    p() { return this.p_val || 0; }
}

// Définition de la fonction CYCLE requise par les tables analytiques
function CYCLE(x) {
    return x - 6.283185307179586 * Math.floor(0.5 * (x * 0.3183098861837907 + 1));
}

importScripts('vsop2013.js', 'ElpMpp02DE_min.js');

// Notification de chargement des modules au thread principal
self.postMessage({ type: 'READY', status: 'ANALYTICAL_KERNEL_READY' });

self.onmessage = function(e) {
    const dataMsg = e.data;
    
    const jd = dataMsg.jd || (dataMsg.data ? dataMsg.data.jd : null);
    const station = dataMsg.station || (dataMsg.data ? { lat: dataMsg.data.lat, lon: dataMsg.data.lon, alt: dataMsg.data.alt } : null);

    if (!jd || !station) return;

    if (dataMsg.type === 'COMPUTE' || dataMsg.type === 'TICK' || dataMsg.command === 'COMPUTE_POSITION') {
        try {
            const astresList = ['soleil', 'lune', 'mercure', 'venus', 'mars', 'jupiter', 'saturne', 'uranus', 'neptune'];
            let results = {};

            const T = (jd - 2451545.0) / 36525.0;

            astresList.forEach(astre => {
                results[astre] = executerCalculTopocentriqueAnalytique(astre, jd, T, station);
            });

            self.postMessage({
                type: 'RESULTS',
                results: results
            });
        } catch (err) {
            self.postMessage({ type: 'ERROR', message: `Erreur analytique critique dans le worker : ${err.toString()}` });
        }
    }
};

function executerCalculTopocentriqueAnalytique(astre, jd, T, station) {
    let x = 0, y = 0, z = 0;
    let distanceKm = 0;

    // Fonction utilitaire sécurisée d'extraction de coordonnées (objet, tableau ou structure r)
    const getCoord = (p, coord) => {
        if (!p) return 0;
        if (p[coord] !== undefined) return p[coord];
        if (p.r && p.r[coord] !== undefined) return p.r[coord];
        if (Array.isArray(p)) return p[coord === 'x' ? 0 : (coord === 'y' ? 1 : 2)] || 0;
        return 0;
    };

    if (astre === 'lune') {
        if (typeof getX2000_DE !== 'function') {
            throw new Error("Fonction getX2000_DE (ELP-2000) non disponible.");
        }
        const posLune = getX2000_DE(T);
        x = getCoord(posLune, 'x');
        y = getCoord(posLune, 'y');
        z = getCoord(posLune, 'z');
        distanceKm = Math.sqrt(x*x + y*y + z*z);
    } else {
        if (typeof vsop2013 === 'undefined') {
            throw new Error("Objet vsop2013 non disponible.");
        }

        let planetObj = null;
        if (astre === 'soleil') {
            planetObj = vsop2013.emb || vsop2013.ear;
        } else {
            const mapPlanetes = {
                'mercure': vsop2013.mer,
                'venus': vsop2013.ven,
                'mars': vsop2013.mar,
                'jupiter': vsop2013.jup,
                'saturne': vsop2013.sat,
                'uranus': vsop2013.ura,
                'neptune': vsop2013.nep
            };
            planetObj = mapPlanetes[astre];
        }

        if (!planetObj) {
            throw new Error(`Modèle VSOP2013 manquant pour l'astre : ${astre}`);
        }

        // Évaluation robuste de la position via les différentes API possibles de l'objet planète
        let posAstre;
        if (typeof planetObj.position === 'function') {
            posAstre = planetObj.position(jd);
        } else if (typeof planetObj.state === 'function') {
            posAstre = planetObj.state(jd);
        } else if (typeof planetObj === 'function') {
            posAstre = planetObj(jd);
        } else {
            posAstre = planetObj;
        }

        const ax = getCoord(posAstre, 'x');
        const ay = getCoord(posAstre, 'y');
        const az = getCoord(posAstre, 'z');

        if (astre === 'soleil') {
            x = -ax * 149597870.7;
            y = -ay * 149597870.7;
            z = -az * 149597870.7;
        } else {
            const terreObj = vsop2013.emb || vsop2013.ear;
            let posTerre;
            if (terreObj) {
                if (typeof terreObj.position === 'function') posTerre = terreObj.position(jd);
                else if (typeof terreObj.state === 'function') posTerre = terreObj.state(jd);
                else posTerre = terreObj;
            }
            const tx = getCoord(posTerre, 'x');
            const ty = getCoord(posTerre, 'y');
            const tz = getCoord(posTerre, 'z');

            x = (ax - tx) * 149597870.7;
            y = (ay - ty) * 149597870.7;
            z = (az - tz) * 149597870.7;
        }
        distanceKm = Math.sqrt(x*x + y*y + z*z);
    }

    const rXY = Math.sqrt(x*x + y*y);
    const declinaisonRad = Math.atan2(z, rXY);
    const ascensionDroiteRad = Math.atan2(y, x);

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
