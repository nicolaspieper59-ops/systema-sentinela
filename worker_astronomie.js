// worker_astronomie.js — KERNEL JPL CHEBYSHEV STRICT (SANS FALLBACK)

const GITHUB_BASE_URL = "https://raw.githubusercontent.com/ton-utilisateur/ton-depot/main/ephemerides";
let cacheChebyshev = {}; // Cache local en mémoire du Worker

async function chargerTrancheJPL(annee) {
    if (cacheChebyshev[annee]) {
        return cacheChebyshev[annee];
    }

    const url = `${GITHUB_BASE_URL}/de440_${annee}.json`;
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`Impossible de charger le segment JPL DE440 pour l'année ${annee} depuis GitHub (${response.statusText}).`);
    }

    const data = await response.json();
    cacheChebyshev[annee] = data;
    return data;
}

function evaluerPolynomeTchebychev(coeffs, tNormalise) {
    // Algorithme de Clenshaw pour l'évaluation de séries de Tchebychev
    let bk1 = 0.0, bk2 = 0.0;
    const x2 = 2.0 * tNormalise;

    for (let i = coeffs.length - 1; i >= 1; i--) {
        const bk = coeffs[i] + x2 * bk1 - bk2;
        bk2 = bk1;
        bk1 = bk;
    }
    return coeffs[0] + tNormalise * bk1 - bk2;
}

self.onmessage = async function (e) {
    const data = e.data;
    if (!data || data.type !== 'COMPUTE') return;

    try {
        const date = new Date(data.timestampUtc);
        const annee = date.getUTCFullYear();

        // 1. Chargement strict du segment JPL depuis GitHub
        const trancheJpl = await chargerTrancheJPL(annee);

        // 2. Calcul des positions exactes JPL via polynômes
        const positions = calculerPositionsJPL(trancheJpl, data.timestampUtc, data.coords);

        self.postMessage({
            type: 'RESULTS',
            payload: positions
        });
    } catch (err) {
        // Interruption immédiate sans mode dégradé si le segment GitHub est inaccessible
        self.postMessage({
            type: 'ERROR',
            message: `[KERNEL ERROR] ${err.message}`
        });
    }
};
