// Importation des bibliothèques nécessaires
importScripts('vsop2013.js', 'ElpMpp02DE_min.js');

// 1. Harmonisation de la fonction modulo 2pi (CYCLE et mod2pi_DE)
function mod2pi(angle) {
    const twoPi = 2 * Math.PI;
    let res = angle % twoPi;
    if (res < 0) {
        res += twoPi;
    }
    return res;
}

// Rattachement global pour assurer la compatibilité
self.CYCLE = mod2pi;
// Si la bibliothèque ELP utilise mod2pi_DE, on la lie également ici si nécessaire
if (typeof self.mod2pi_DE === 'undefined') {
    self.mod2pi_DE = mod2pi;
}

// 2. Écouteur de messages avec journalisation robuste des erreurs
self.onmessage = function(event) {
    const { action, jd, astre } = event.data;

    if (action === 'CALCULATE') {
        try {
            // Validation basique du Jour Julien
            if (typeof jd !== 'number' || isNaN(jd)) {
                throw new Error("Jour Julien (JD) invalide transmis au Worker.");
            }

            let resultData;

            // Exemple de routage du calcul selon l'astre
            if (astre === 'lune') {
                // Calcul ELP pour la Lune (attention à l'échelle de temps en siècles juliens)
                const T_siecles = (jd - 2451545.0) / 36525.0;
                resultData = getX2000_DE(T_siecles);
            } else {
                // Calcul VSOP pour les planètes (millénaires juliens)
                const jy2k = (jd - 2451545.0) / 365250.0;
                // Appel dynamique sécurisé de la fonction planétaire correspondante
                if (typeof vsop2013 !== 'undefined' && vsop2013[astre]) {
                    resultData = vsop2013[astre](jy2k);
                } else {
                    throw new Error(`Module ou fonction VSOP introuvable pour l'astre : ${astre}`);
                }
            }

            let resultData;
const t = (jd - 2451545.0) / 365250.0; // Millénaires juliens pour VSOP

switch(astre) {
    let raw;
    case 'mercure': raw = vsop2013.mer(t); break;
    case 'venus':   raw = vsop2013.ven(t); break;
    case 'soleil':  raw = vsop2013.sun(t); break; // ou équivalent terre inversée
    case 'mars':    raw = vsop2013.mar(t); break;
    case 'jupiter': raw = vsop2013.jup(t); break;
    case 'saturne': raw = vsop2013.sat(t); break;
    case 'uranus':  raw = vsop2013.ura(t); break;
    case 'neptune': raw = vsop2013.nep(t); break;
    default: throw new Error(`Astre non supporté : ${astre}`);
        }

            // Renvoi du succès vers le thread principal
            self.postMessage({
                type: 'SUCCESS',
                astre: astre,
                data: resultData
            });

        } catch (error) {
            // 3. Renvoi d'erreur détaillé au lieu d'un bloc catch silencieux
            self.postMessage({
                type: 'ERROR',
                astre: astre || 'inconnu',
                message: error.message,
                stack: error.stack || null,
                jd: jd
            });
        }
    }
};
