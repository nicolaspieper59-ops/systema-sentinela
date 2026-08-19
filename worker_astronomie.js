// Importation des modules (fonctionne dans un Web Worker moderne)
importScripts('vsop2013.js', 'ElpMpp02DE_min.js');

function mod2pi(angle) {
    const twoPi = 2 * Math.PI;
    let res = angle % twoPi;
    return res < 0 ? res + twoPi : res;
}

self.CYCLE = mod2pi;
if (typeof self.mod2pi_DE === 'undefined') self.mod2pi_DE = mod2pi;

const CORPS_CELESTES = ['soleil', 'lune', 'mercure', 'venus', 'mars', 'jupiter', 'saturne', 'uranus', 'neptune'];

self.onmessage = function(event) {
    const data = event.data || {};
    const type = data.type;
    const jd = data.jd;

    if (type === 'COMPUTE' || data.action === 'CALCULATE') {
        try {
            if (typeof jd !== 'number' || isNaN(jd)) {
                throw new Error("Date Julian (JD) invalide ou manquante.");
            }

            let results = {};
            // Siècles juliens depuis J2000.0 (utilisé généralement pour la Lune / ELP)
            const T_siecles = (jd - 2451545.0) / 36525.0;
            // Millénaires juliens depuis J2000.0 (requis par VSOP2013)
            const jy2k = (jd - 2451545.0) / 365250.0;

            CORPS_CELESTES.forEach(astre => {
                if (astre === 'lune') {
                    if (typeof getX2000_DE === 'function') {
                        results[astre] = getX2000_DE(T_siecles);
                    } else if (typeof getX2000_LLR === 'function') {
                        results[astre] = getX2000_LLR(T_siecles);
                    } else {
                        throw new Error("Fonction de calcul pour la Lune introuvable.");
                    }
                } else {
                    // Pour le Soleil et les planètes via VSOP2013
                    if (typeof vsop2013 !== 'undefined' && typeof vsop2013[astre] === 'function') {
                        results[astre] = vsop2013[astre](jy2k);
                    } else {
                        throw new Error(`Module VSOP2013 introuvable ou fonction absente pour : ${astre}`);
                    }
                }
            });

            self.postMessage({
                type: 'RESULTS',
                results: results
            });

        } catch (error) {
            self.postMessage({
                type: 'ERROR',
                message: error.message
            });
        }
    }
};
